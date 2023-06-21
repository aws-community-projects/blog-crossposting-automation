import { Table } from "aws-cdk-lib/aws-dynamodb";
import {
  Choice,
  Condition,
  Fail,
  JsonPath,
  Parallel,
  Pass,
  StateMachine,
  Succeed,
  TaskInput,
} from "aws-cdk-lib/aws-stepfunctions";
import {
  CallAwsService,
  DynamoAttributeValue,
  DynamoGetItem,
  DynamoPutItem,
  DynamoUpdateItem,
  EventBridgePutEvents,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { StepFunctionBranch } from "./step-function-branch";
import { IEventBus } from "aws-cdk-lib/aws-events";
import { Duration } from "aws-cdk-lib";

export interface CrossPostStepFunctionProps {
  adminEmail?: string;
  canonical: "dev" | "medium" | "hashnode" | "amplify";
  devTo?: {
    fn: NodejsFunction;
  };
  eventBus: IEventBus;
  hashnode?: {
    url: string;
    fn: NodejsFunction;
  };
  medium?: {
    url: string;
    fn: NodejsFunction;
  };
  sendApiRequestFn: NodejsFunction;
  table: Table;
}
export class CrossPostStepFunction extends Construct {
  stateMachine: StateMachine;
  constructor(scope: Construct, id: string, props: CrossPostStepFunctionProps) {
    super(scope, id);

    const {
      adminEmail,
      canonical,
      devTo,
      eventBus,
      hashnode,
      medium,
      sendApiRequestFn,
      table,
    } = props;
    const getExistingArticle = new DynamoGetItem(this, `GetExistingArticle`, {
      table,
      key: {
        pk: DynamoAttributeValue.fromString(
          JsonPath.stringAt(`States.Format('{}#{}', $.commit, $.fileName)`)
        ),
        sk: DynamoAttributeValue.fromString("article"),
      },
      resultPath: "$.existingArticle",
    });
    const setArticleInProgress = new DynamoUpdateItem(
      this,
      `SetArticleInProgress`,
      {
        table,
        key: {
          pk: DynamoAttributeValue.fromString(
            JsonPath.stringAt(`States.Format('{}#{}', $.commit, $.fileName)`)
          ),
          sk: DynamoAttributeValue.fromString("article"),
        },
        updateExpression: "SET #status = :status",
        expressionAttributeNames: {
          "#status": "status",
        },
        expressionAttributeValues: {
          ":status": DynamoAttributeValue.fromString("in progress"),
        },
        resultPath: JsonPath.DISCARD,
      }
    );
    const successDuplicateRequest = new Succeed(
      this,
      `SuccessDuplicateRequest`,
      {
        comment: "This article has already been processed",
      }
    );
    const hasArticleBeenProcessed = new Choice(this, `HasArticleBeenProcessed`);
    getExistingArticle.next(hasArticleBeenProcessed);
    hasArticleBeenProcessed.when(
      Condition.isNotPresent("$.existingArticle.Item"),
      setArticleInProgress
    );
    hasArticleBeenProcessed.when(
      Condition.and(
        Condition.isPresent("$.existingArticle.Item"),
        Condition.stringEquals("$.existingArticle.Item.status.S", "failed")
      ),
      setArticleInProgress
    );
    hasArticleBeenProcessed.otherwise(successDuplicateRequest);
    const loadArticleCatalog = new CallAwsService(this, "LoadArticleCatalog", {
      service: "dynamodb",
      action: "query",
      iamAction: "dyanamodb:Query",
      iamResources: [table.tableArn],
      parameters: {
        TableName: table.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "#GSI1PK = :GSI1PK",
        ExpressionAttributeNames: {
          "#GSI1PK": "GSI1PK",
        },
        ExpressionAttributeValues: {
          ":GSI1PK": {
            S: "article",
          },
        },
      },
      resultPath: "$.catalog",
    });
    setArticleInProgress.next(loadArticleCatalog);
    // addCatch
    const updateFailure = new Fail(this, `UpdateFailure`);
    const updateArticleRecordFailure = new DynamoUpdateItem(
      this,
      `UpdateArticleRecordFailure`,
      {
        table,
        key: {
          pk: DynamoAttributeValue.fromString(
            JsonPath.stringAt(
              `States.Format('{}#{}', $$.Execution.Input.commit, $$.Execution.Input.fileName)`
            )
          ),
          sk: DynamoAttributeValue.fromString("article"),
        },
        updateExpression: "SET #status = :status",
        expressionAttributeNames: {
          "#status": "status",
        },
        expressionAttributeValues: {
          ":status": DynamoAttributeValue.fromString("failed"),
        },
        resultPath: JsonPath.DISCARD,
      }
    );
    updateArticleRecordFailure.next(updateFailure);
    loadArticleCatalog.addCatch(updateArticleRecordFailure);

    // PARALLEL
    const transformAndPublish = new Parallel(this, "TransformAndPublish", {
      resultPath: "$.transform",
    });
    let transformAndPublishCanonical = transformAndPublish;
    if (canonical !== "amplify") {
      transformAndPublishCanonical = new Parallel(
        this,
        "TransformAndPublishCanonical",
        {
          resultPath: "$.canonical",
        }
      );
      transformAndPublishCanonical.addCatch(new Fail(this, `CanonicalFailed`));
      loadArticleCatalog.next(transformAndPublishCanonical);
      transformAndPublishCanonical.next(transformAndPublish);
    } else {
      loadArticleCatalog.next(transformAndPublish);
    }

    const parallelResults: string[] = [];
    if (devTo) {
      const devToBranch = new StepFunctionBranch(this, `Dev`, {
        ...(canonical === "dev" || canonical === "amplify"
          ? {}
          : { canonical }),
        parsePostFn: devTo.fn,
        publishPayload: TaskInput.fromObject({
          secretKey: "dev",
          auth: {
            location: "header",
            key: "api-key",
          },
          request: {
            method: "POST",
            headers: {
              accept: "application/vnd.forem.api-v1+json",
            },
            baseUrl: "https://dev.to/api/articles",
            "body.$": "$.payload",
          },
        }),
        sendApiRequestFn,
        table,
      });
      if (canonical === "dev") {
        transformAndPublishCanonical.branch(devToBranch.prefixStates());
      } else {
        transformAndPublish.branch(devToBranch.prefixStates());
        parallelResults.push("dev");
      }
    }
    if (medium) {
      const mediumBranch = new StepFunctionBranch(this, `Medium`, {
        ...(canonical === "medium" || canonical === "amplify"
          ? {}
          : { canonical }),
        parsePostFn: medium.fn,
        publishPayload: TaskInput.fromObject({
          secretKey: "medium",
          auth: {
            location: "query",
            key: "accessToken",
          },
          request: {
            method: "POST",
            baseUrl: `${medium.url}`,
            "body.$": "$.payload",
          },
        }),
        sendApiRequestFn,
        table,
      });
      if (canonical === "medium") {
        transformAndPublishCanonical.branch(mediumBranch.prefixStates());
      } else {
        transformAndPublish.branch(mediumBranch.prefixStates());
        parallelResults.push("medium");
      }
    }

    if (hashnode) {
      const hashnodeBranch = new StepFunctionBranch(this, `Hashnode`, {
        ...(canonical === "hashnode" || canonical === "amplify"
          ? {}
          : { canonical }),
        hashnodeBlogUrl: hashnode.url,
        parsePostFn: hashnode.fn,
        publishPayload: TaskInput.fromObject({
          secretKey: "hashnode",
          auth: {
            location: "header",
            key: "Authorization",
          },
          request: {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            baseUrl: "https://api.hashnode.com",
            "body.$": "$.payload",
          },
        }),
        sendApiRequestFn,
        table,
      });
      if (canonical === "hashnode") {
        transformAndPublishCanonical.branch(hashnodeBranch.prefixStates());
      } else {
        transformAndPublish.branch(hashnodeBranch.prefixStates());
        parallelResults.push("hashnode");
      }
    }

    const formatFailureCheck = new Pass(this, "FormatFailureCheck", {
      parameters: {
        "canonical.$": "$.canonical[0]",
        "results.$": "$.transform",
        failureFormat: {
          success: false,
        },
      },
    });
    transformAndPublish.next(formatFailureCheck);
    const checkForFailures = new Pass(this, `CheckForFailures`, {
      parameters: {
        "canonical.$": "$.canonical",
        "results.$": "$.results",
        "hasFailure.$": "States.ArrayContains($.results, $.failureFormat)",
      },
    });
    formatFailureCheck.next(checkForFailures);
    const didFailureOccur = new Choice(this, `DidFailureOccur`);
    checkForFailures.next(didFailureOccur);
    const updateArticleRecordFailed = new DynamoUpdateItem(
      this,
      `UpdateArticleRecordFailed`,
      {
        table,
        key: {
          pk: DynamoAttributeValue.fromString(
            JsonPath.stringAt(
              `States.Format('{}#{}', $$.Execution.Input.commit, $$.Execution.Input.fileName)`
            )
          ),
          sk: DynamoAttributeValue.fromString("article"),
        },
        updateExpression: "SET #status = :status",
        expressionAttributeNames: {
          "#status": "status",
        },
        expressionAttributeValues: {
          ":status": DynamoAttributeValue.fromString("failed"),
        },
        resultPath: JsonPath.DISCARD,
      }
    );
    didFailureOccur.when(
      Condition.booleanEquals("$.hasFailure", true),
      updateArticleRecordFailed
    );

    const success = new Succeed(this, `Success`);

    const saveArticles = new Parallel(this, `SaveArticles`);
    saveArticles.next(success);

    const formatArticle = new Pass(this, `FormatArticle`, {
      parameters: {
        "url.$": "$.results[0].url",
        ...(canonical !== "amplify"
          ? {
              [`${canonical}Url.$`]: `$.canonical.${canonical}Url`,
            }
          : {}),
        ...parallelResults.reduce((p, c, ind) => {
          return { ...p, [`${c}Url.$`]: `$.results[${ind}].${c}Url` };
        }, {} as Record<string, string>),
      },
    });
    didFailureOccur.otherwise(formatArticle);
    formatArticle.next(saveArticles);

    const saveCatalogArticle = new DynamoPutItem(this, `SaveArticle`, {
      table,
      item: {
        pk: DynamoAttributeValue.fromString(JsonPath.stringAt(`$.url`)),
        sk: DynamoAttributeValue.fromString("article"),
        GSI1PK: DynamoAttributeValue.fromString("article"),
        GSI1SK: DynamoAttributeValue.fromString(
          JsonPath.stringAt(`$$.Execution.Input.fileName`)
        ),
        links: DynamoAttributeValue.fromMap({
          ...(devTo
            ? {
                devUrl: DynamoAttributeValue.fromString(
                  JsonPath.stringAt(`$.devUrl`)
                ),
              }
            : {}),
          ...(hashnode
            ? {
                hashnodeUrl: DynamoAttributeValue.fromString(
                  JsonPath.stringAt(`$.hashnodeUrl`)
                ),
              }
            : {}),
          ...(medium
            ? {
                mediumUrl: DynamoAttributeValue.fromString(
                  JsonPath.stringAt(`$.mediumUrl`)
                ),
              }
            : {}),
          url: DynamoAttributeValue.fromString(JsonPath.stringAt(`$.url`)),
        }),
      },
      resultPath: JsonPath.DISCARD,
    });
    saveArticles.branch(saveCatalogArticle);

    const updateArticleRecordSuccess = new DynamoUpdateItem(
      this,
      `UpdateArticleRecordSuccess`,
      {
        table,
        key: {
          pk: DynamoAttributeValue.fromString(
            JsonPath.stringAt(
              `States.Format('{}#{}', $$.Execution.Input.commit, $$.Execution.Input.fileName)`
            )
          ),
          sk: DynamoAttributeValue.fromString("article"),
        },
        updateExpression: "SET #status = :status",
        expressionAttributeNames: {
          "#status": "status",
        },
        expressionAttributeValues: {
          ":status": DynamoAttributeValue.fromString("succeeded"),
        },
        resultPath: JsonPath.DISCARD,
      }
    );
    saveArticles.branch(updateArticleRecordSuccess);

    const somethingWentWrong = new Fail(this, `SomethingWentWrong`, {
      error: "PublishError",
      cause: "An error occured publishing to one or more sites",
    });

    if (adminEmail) {
      const shouldSendFailureEmail = new Choice(this, `ShouldSendFailureEmail`);
      updateArticleRecordFailed.next(shouldSendFailureEmail);
      shouldSendFailureEmail.otherwise(somethingWentWrong);
      const sendFailureEmail = new EventBridgePutEvents(
        this,
        "SendFailureEmail",
        {
          entries: [
            {
              detail: TaskInput.fromObject({
                subject: "Cross Post Failed!",
                to: `${adminEmail}`,
                "html.$":
                  "States.Format('<p>Republishing of your new blog post failed :(</p><p>Found file: <i>{}</i></p><p><a href=\"${ExecutionUrl}/{}\">View state machine execution</a></p>', $$.Execution.Input.fileName, $$.Execution.Id)",
              }),
              eventBus,
              detailType: "Send Email",
              source: "user.CrossPostStateMachine",
            },
          ],
        }
      );
      shouldSendFailureEmail.when(
        Condition.and(
          Condition.isPresent("$$.Execution.Input.sendStatusEmail"),
          Condition.booleanEquals("$$.Execution.Input.sendStatusEmail", true)
        ),
        sendFailureEmail
      );
      const sendEmailEvent = new EventBridgePutEvents(this, "SendEmailEvent", {
        entries: [
          {
            detail: TaskInput.fromObject({
              subject: "Cross Post Successful!",
              to: `${adminEmail}`,
              "html.$":
                'States.Format(\'<p>Republishing of your new blog post was successful!</p><p>Found file: <i>{}</i></p><p><b>Links</b></p><ul><li><b><a href="{}">Medium</a></b></li><li><b><a href="{}">Dev.to</a></b></li><li><b><a href="{}">Hashnode</a></b></li></ul>\', $$.Execution.Input.fileName, $.mediumUrl, $.devUrl, $.hashnodeUrl)',
            }),
            eventBus,
            detailType: "Send Email",
            source: "user.CrossPostStateMachine",
          },
        ],
      });
      sendFailureEmail.next(sendEmailEvent);
      sendEmailEvent.next(success);
    } else {
      updateArticleRecordFailed.next(somethingWentWrong);
    }

    this.stateMachine = new StateMachine(this, `CrossPostMachine`, {
      definition: getExistingArticle,
      timeout: Duration.minutes(5),
    });
  }
}
