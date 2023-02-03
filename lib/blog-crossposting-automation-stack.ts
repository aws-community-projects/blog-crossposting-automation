import { StackProps, Stack } from "aws-cdk-lib";
import { EventBus, Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { join } from "path";
import { DynamoDb } from "./dyanmo";

export interface BlogCrosspostingAutomationStackProps extends StackProps {
  githubOwner: string;
  githubRepo: string;
  amplifyProjectId: string;
  mediumPublicationId: string;
  mediumAuthorId: string;
  devOrganizationId: string;
  hashnodePublicationId: string;
  hashnodeBlogUrl: string;
  blogBaseUrl: string;
  blogContentPath: string;
  notificationEmail: string;
  sendgridFromEmail: string;
}
export class BlogCrosspostingAutomationStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: BlogCrosspostingAutomationStackProps
  ) {
    super(scope, id, props);

    const { table } = new DynamoDb(this, `CrosspostTable`);

    const eventBus = EventBus.fromEventBusName(this, `Bus`, "default");

    const secret = Secret.fromSecretNameV2(
      this,
      `CrosspostSecrets`,
      `CrosspostSecrets`
    );

    const lambdaProps = {
      runtime: Runtime.NODEJS_18_X,
      environment: {
        TABLE_NAME: table.tableName,
        SECRET_ID: secret.secretName,
      },
    };

    const parsePostFn = new NodejsFunction(this, `ParsePostFn`, {
      ...lambdaProps,
      entry: join(__dirname, `../functions/parse-post.ts`),
    });

    const sendApiRequestFn = new NodejsFunction(this, `SendApiRequestFn`, {
      ...lambdaProps,
      entry: join(__dirname, `../functions/send-api-request.ts`),
    });
    secret.grantRead(sendApiRequestFn);

    const loadCrossPostsFn = new NodejsFunction(this, `LoadCrossPostsFn`, {
      ...lambdaProps,
      entry: join(__dirname, `../functions/load-cross-posts.ts`),
    });
    table.grantWriteData(loadCrossPostsFn);

    const identifyNewContentFn = new NodejsFunction(
      this,
      `IdentifyNewContentFn`,
      {
        ...lambdaProps,
        entry: join(__dirname, `../functions/identify-new-content.ts`),
      }
    );
    secret.grantRead(identifyNewContentFn);
    new Rule(this, `NewArticlesRule`, {
      eventBus,
      eventPattern: {
        source: ["aws.amplify"],
        detailType: ["Amplify Deployment Status Change"],
        detail: {
          appId: props.amplifyProjectId,
          jobStatus: "SUCCEED",
        },
      },
      targets: [new LambdaFunction(identifyNewContentFn)],
    });
    eventBus.grantPutEventsTo(identifyNewContentFn);

    const sendEmailFn = new NodejsFunction(this, `SendEmailFn`, {
      ...lambdaProps,
      entry: join(__dirname, `../functions/send-email-sendgrid.ts`),
    });
    secret.grantRead(sendEmailFn);
    new Rule(this, `SendEmailRule`, {
      eventBus,
      eventPattern: {
        detailType: ["Send Email"],
      },
      targets: [new LambdaFunction(sendEmailFn)],
    });

    // TODO convert the state machine

    new Rule(this, "CrossPostMachineRule", {
      eventBus,
      eventPattern: {
        source: [`cross-post`],
        detailType: ["process-new-content"],
      },
      // targets: [new SfnStateMachine(stateMachine, {})]
    });
  }
}
