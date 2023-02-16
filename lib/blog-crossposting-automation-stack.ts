import { StackProps, Stack, CfnOutput, Duration } from "aws-cdk-lib";
import { EventBus, Rule } from "aws-cdk-lib/aws-events";
import {
  LambdaFunction,
  SfnStateMachine,
} from "aws-cdk-lib/aws-events-targets";
import { Architecture, FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { join } from "path";
import { DynamoDb } from "./dyanmo";
import {
  CrossPostStepFunction,
  CrossPostStepFunctionProps,
} from "./step-function";

export interface BlogCrosspostingAutomationStackProps extends StackProps {
  amplify?: {
    amplifyProjectId: string;
    blogBaseUrl: string;
  };
  // TODO: properly handle canonical urls for non-amplify blogs
  canonical: "dev" | "medium" | "hashnode" | "amplify";
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
    hashnodePublicationId?: string;
    hashnodeBlogUrl: string;
  };
  medium?: {
    mediumPublicationId?: string;
    mediumAuthorId?: string;
  };
  newContentIndicator?: string;
  secretName?: string;
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
      canonical,
      commitTimeToleranceMinutes,
      devTo,
      dryRun,
      email,
      github,
      hashnode,
      medium,
      newContentIndicator,
      secretName = `CrosspostSecrets`,
    } = props;

    const { table } = new DynamoDb(this, `CrosspostTable`);

    const eventBus = EventBus.fromEventBusName(this, `Bus`, "default");

    const secret = Secret.fromSecretNameV2(
      this,
      `CrosspostSecrets`,
      secretName
    );

    const lambdaProps = {
      architecture: Architecture.ARM_64,
      memory: 1024,
      timeout: Duration.minutes(5),
      runtime: Runtime.NODEJS_18_X,
      environment: {
        TABLE_NAME: table.tableName,
        SECRET_ID: secret.secretName,
      },
    };

    const sendApiRequestFn = new NodejsFunction(this, `SendApiRequestFn`, {
      ...lambdaProps,
      entry: join(__dirname, `../functions/send-api-request.ts`),
    });
    sendApiRequestFn.addEnvironment("DRY_RUN", dryRun ? "1" : "0");
    secret.grantRead(sendApiRequestFn);

    const crossPostStepFunctionProps: CrossPostStepFunctionProps = {
      ...(email?.adminEmail
        ? {
            adminEmail: email.adminEmail,
          }
        : {}),
      eventBus,
      sendApiRequestFn,
      table,
    };
    if (devTo?.devOrganizationId) {
      const parseDevFn = new NodejsFunction(this, `ParseDevToFn`, {
        ...lambdaProps,
        entry: join(__dirname, `../functions/parse-dev-post.ts`),
      });
      parseDevFn.addEnvironment("CANONICAL", canonical);
      parseDevFn.addEnvironment("DEV_ORG_ID", devTo.devOrganizationId);
      if (amplify) {
        parseDevFn.addEnvironment("BLOG_BASE_URL", amplify.blogBaseUrl);
      }
      crossPostStepFunctionProps.devTo = {
        fn: parseDevFn!,
      };
    }
    if (hashnode?.hashnodeBlogUrl) {
      const parseHashnodeFn = new NodejsFunction(this, `ParseHashnodeFn`, {
        ...lambdaProps,
        entry: join(__dirname, `../functions/parse-hashnode-post.ts`),
      });
      parseHashnodeFn.addEnvironment("CANONICAL", canonical);
      if (amplify) {
        parseHashnodeFn.addEnvironment("BLOG_BASE_URL", amplify.blogBaseUrl);
      }
      if (hashnode.hashnodePublicationId) {
        parseHashnodeFn.addEnvironment(
          "HASHNODE_PUBLICATION_ID",
          hashnode.hashnodePublicationId
        );
      }
      crossPostStepFunctionProps.hashnode = {
        fn: parseHashnodeFn!,
        url: hashnode.hashnodeBlogUrl,
      };
    }
    if (medium?.mediumAuthorId || medium?.mediumPublicationId) {
      const parseMediumFn = new NodejsFunction(this, `ParseMediumFn`, {
        ...lambdaProps,
        entry: join(__dirname, `../functions/parse-medium-post.ts`),
      });
      parseMediumFn.addEnvironment("CANONICAL", canonical);
      if (amplify) {
        parseMediumFn.addEnvironment("BLOG_BASE_URL", amplify.blogBaseUrl);
      }
      crossPostStepFunctionProps.medium = {
        fn: parseMediumFn!,
        url: medium.mediumPublicationId
          ? `https://api.medium.com/v1/publications/${medium.mediumPublicationId}/posts`
          : `https://api.medium.com/v1/users/${medium.mediumAuthorId}/posts`,
      };
    }

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
    identifyNewContentFn.addEnvironment("BLOG_PATH", github.path);
    if (commitTimeToleranceMinutes) {
      identifyNewContentFn.addEnvironment(
        "COMMIT_TIME_TOLERANCE_MINUTES",
        `${commitTimeToleranceMinutes}`
      );
    }
    if (newContentIndicator) {
      identifyNewContentFn.addEnvironment(
        "NEW_CONTENT_INDICATOR",
        newContentIndicator
      );
    }
    secret.grantRead(identifyNewContentFn);
    eventBus.grantPutEventsTo(identifyNewContentFn);

    if (amplify?.amplifyProjectId) {
      new Rule(this, `NewArticlesRule`, {
        eventBus,
        eventPattern: {
          source: ["aws.amplify"],
          detailType: ["Amplify Deployment Status Change"],
          detail: {
            appId: [amplify.amplifyProjectId],
            jobStatus: ["SUCCEED"],
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

    if (email?.sendgridFromEmail) {
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

    const { stateMachine } = new CrossPostStepFunction(this, `CrossPostStepFn`, crossPostStepFunctionProps);
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
