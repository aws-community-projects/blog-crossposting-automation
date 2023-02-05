import { StackProps, Stack, CfnOutput } from "aws-cdk-lib";
import { EventBus, Rule } from "aws-cdk-lib/aws-events";
import {
  LambdaFunction,
  SfnStateMachine,
} from "aws-cdk-lib/aws-events-targets";
import { FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { join } from "path";
import { DynamoDb } from "./dyanmo";
import { CrossPostStepFunction } from "./step-function";

export interface BlogCrosspostingAutomationStackProps extends StackProps {
  amplify?: {
    amplifyProjectId: string;
  };
  blogBaseUrl: string;
  commitTimeToleranceMinutes?: number;
  devTo?: {
    devOrganizationId: string;
  };
  dryRun?: boolean;
  email?: {
    adminEmail: string;
    sendgridFromEmail: string;
  };
  github: {
    owner: string;
    repo: string;
    path: string;
  };
  hashnode?: {
    hashnodePublicationId: string;
    hashnodeBlogUrl: string;
  };
  medium?: {
    mediumPublicationId?: string;
    mediumAuthorId?: string;
  };
  newContentIndicator?: string;
}
export class BlogCrosspostingAutomationStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: BlogCrosspostingAutomationStackProps
  ) {
    super(scope, id, props);
    const {
      amplify,
      blogBaseUrl,
      commitTimeToleranceMinutes,
      devTo,
      dryRun,
      email,
      github,
      hashnode,
      medium,
      newContentIndicator,
    } = props;

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

    let parseDevFn, parseHashnodeFn, parseMediumFn;
    if (devTo) {
      parseDevFn = new NodejsFunction(this, `ParseDevToFn`, {
        ...lambdaProps,
        entry: join(__dirname, `../functions/parse-dev-post.ts`),
      });
      parseDevFn.addEnvironment("BLOG_BASE_URL", blogBaseUrl);
      parseDevFn.addEnvironment("DEV_ORG_ID", devTo.devOrganizationId);
    }
    if (hashnode) {
      parseHashnodeFn = new NodejsFunction(this, `ParseHashnodeFn`, {
        ...lambdaProps,
        entry: join(__dirname, `../functions/parse-hashnode-post.ts`),
      });
      parseHashnodeFn.addEnvironment("BLOG_BASE_URL", blogBaseUrl);
      parseHashnodeFn.addEnvironment("HASHNODE_PUBLICATION_ID", hashnode.hashnodePublicationId);
    }
    if (medium) {
      parseMediumFn = new NodejsFunction(this, `ParseMediumFn`, {
        ...lambdaProps,
        entry: join(__dirname, `../functions/parse-medium-post.ts`),
      });
      parseMediumFn.addEnvironment("BLOG_BASE_URL", blogBaseUrl);
    }

    const sendApiRequestFn = new NodejsFunction(this, `SendApiRequestFn`, {
      ...lambdaProps,
      entry: join(__dirname, `../functions/send-api-request.ts`),
    });
    sendApiRequestFn.addEnvironment("DRY_RUN", dryRun ? '1' : '0');
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
    identifyNewContentFn.addEnvironment("OWNER", github.owner);
    identifyNewContentFn.addEnvironment("REPO", github.repo);
    identifyNewContentFn.addEnvironment("PATH", github.path);
    if (commitTimeToleranceMinutes) {
      identifyNewContentFn.addEnvironment("COMMIT_TIME_TOLERANCE_MINUTES", `${commitTimeToleranceMinutes}`);
    }
    if (newContentIndicator) {
      identifyNewContentFn.addEnvironment("NEW_CONTENT_INDICATOR", newContentIndicator);
    }
    secret.grantRead(identifyNewContentFn);
    eventBus.grantPutEventsTo(identifyNewContentFn);

    if (amplify) {
      new Rule(this, `NewArticlesRule`, {
        eventBus,
        eventPattern: {
          source: ["aws.amplify"],
          detailType: ["Amplify Deployment Status Change"],
          detail: {
            appId: amplify.amplifyProjectId,
            jobStatus: "SUCCEED",
          },
        },
        targets: [new LambdaFunction(identifyNewContentFn)],
      });
    } else {
      const fnUrl = identifyNewContentFn.addFunctionUrl({
        authType: FunctionUrlAuthType.NONE,
        cors: {
          allowedOrigins: ["*"],
        },
      });
      new CfnOutput(this, `GithubWebhook`, { value: fnUrl.url });
    }

    if (email) {
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
    }

    const { stateMachine } = new CrossPostStepFunction(
      this,
      `CrossPostStepFn`,
      {
        ...(email
          ? {
              adminEmail: email.adminEmail,
            }
          : {}),
        ...(devTo
          ? {
              fn: parseDevFn,
            }
          : {}),
        ...(hashnode
          ? {
              fn: parseHashnodeFn,
              url: hashnode.hashnodeBlogUrl,
            }
          : {}),
        ...(medium
          ? {
              fn: parseMediumFn,
              url: medium.mediumPublicationId ? `https://api.medium.com/v1/publications/${medium.mediumPublicationId}/posts` : `https://api.medium.com/v1/users/${medium.mediumAuthorId}/posts`,
            }
          : {}),
        eventBus,
        sendApiRequestFn,
        table,
      }
    );
    table.grantReadWriteData(stateMachine);
    eventBus.grantPutEventsTo(stateMachine);

    new Rule(this, "CrossPostMachineRule", {
      eventBus,
      eventPattern: {
        source: [`cross-post`],
        detailType: ["process-new-content"],
      },
      targets: [new SfnStateMachine(stateMachine, {})],
    });
  }
}
