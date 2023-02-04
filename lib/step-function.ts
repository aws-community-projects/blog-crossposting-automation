import { Table } from "aws-cdk-lib/aws-dynamodb";
import {
  Choice,
  Condition,
  Fail,
  JsonPath,
  Parallel,
  Pass,
  Succeed,
  TaskInput,
} from "aws-cdk-lib/aws-stepfunctions";
import {
  CallAwsService,
  DynamoAttributeValue,
  DynamoGetItem,
  DynamoUpdateItem,
  LambdaInvoke,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { StepFunctionBranch } from "./step-function-branch";

export interface CrossPostStepFunctionProps {
  table: Table;
  devTo?: boolean;
  medium?: boolean;
  hashnode?: boolean;
  parsePostFn: NodejsFunction;
  sendApiRequestFn: NodejsFunction;
}
export class CrossPostStepFunction extends Construct {
  constructor(scope: Construct, id: string, props: CrossPostStepFunctionProps) {
    super(scope, id);

    const { parsePostFn, sendApiRequestFn, table } = props;
    const getExistingArticle = new DynamoGetItem(this, `GetExistingArticle`, {
      table,
      key: {
        pk: DynamoAttributeValue.fromString(
          JsonPath.stringAt(`States.Format('{}#{}', $.commit, $.fileName)`)
        ),
        sk: DynamoAttributeValue.fromString("article"),
      },
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
      `SuccessDuplicateRequest`
    );
    const hasArticleBeenProcessed = new Choice(this, `HasArticleBeenProcessed`);
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
      iamResources: [table.tableArn],
      parameters: {
        TableName: table.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "#GSI1PK = :GSI1PK",
        ExpressionAttributeNames: {
          "#GSI1PK": "GSI1PK",
        },
        ExpressionAttributeValues: {
          ":GSI1PK": DynamoAttributeValue.fromString("article"),
        },
      },
      resultPath: "$.catalog",
    });
    // addCatch
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
    loadArticleCatalog.addCatch(updateArticleRecordFailure);

    // PARALLEL
    const devTo = new StepFunctionBranch(this, `Dev`, {
      parsePostFn,
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
    const medium = new StepFunctionBranch(this, `Medium`, {
      parsePostFn,
      publishPayload: TaskInput.fromObject({
        secretKey: "medium",
        auth: {
          location: "query",
          key: "accessToken",
        },
        request: {
          method: "POST",
          baseUrl: "${MediumUrl}", // TODO <--
          "body.$": "$.payload",
        },
      }),
      sendApiRequestFn,
      table,
    });
    const hashnode = new StepFunctionBranch(this, `Hashnode`, {
      parsePostFn,
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

    const parallel = new Parallel(this, "TransformAndPublish")
      .branch(devTo.prefixStates())
      .branch(hashnode.prefixStates())
      .branch(medium.prefixStates());

    const formatFailureCheck = new Pass(this, "FormatFailureCheck", {
      parameters: {
        "results.$": "$.transform",
        failureFormat: {
          success: false,
        },
      },
    });
    parallel.next(formatFailureCheck);
    const checkForFailures = new Pass(this, `CheckForFailures`, {
      parameters: {
        "results.$": "$.results",
        "hasFailure.$": "States.ArrayContains($.results, $.failureFormat)",
      },
    });
    formatFailureCheck.next(checkForFailures);
    const didFailureOccur = new Choice(this, `DidFailureOccur`);
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
      Condition.booleanEquals("$.existingArticle.Item.status.S", true),
      updateArticleRecordFailed
    );

    const shouldSendFailureEmail = new Choice(this, `ShouldSendFailureEmail`);
    updateArticleRecordFailed.next(shouldSendFailureEmail);
    const somethingWentWrong = new Fail(this, `SomethingWentWrong`, {
      error: "PublishError",
      cause: "An error occured publishing to one or more sites",
    });
    shouldSendFailureEmail.otherwise(somethingWentWrong);
  }
}
