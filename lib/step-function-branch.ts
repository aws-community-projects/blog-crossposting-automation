import { Table } from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  Pass,
  Choice,
  Condition,
  TaskInput,
  JsonPath,
  StateMachineFragment,
  INextable,
  State,
} from "aws-cdk-lib/aws-stepfunctions";
import {
  LambdaInvoke,
  DynamoUpdateItem,
  DynamoAttributeValue,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";

export interface StepFunctionBranchProps {
  hashnodeBlogUrl?: string;
  canonical?: string;
  parsePostFn: NodejsFunction;
  publishPayload: TaskInput;
  sendApiRequestFn: NodejsFunction;
  table: Table;
}

export class StepFunctionBranch extends StateMachineFragment {
  public readonly startState: State;
  public readonly endStates: INextable[];
  constructor(scope: Construct,
    id: string,
    props: StepFunctionBranchProps) {
      super(scope, id);
      const {
        hashnodeBlogUrl,
        canonical,
        parsePostFn,
        publishPayload,
        sendApiRequestFn,
        table,
      } = props;
      const format = id.toLowerCase();
      const skipped = new Pass(this, `Skipped`, {
        parameters: {
          "url.$": "$.existingArticle.Item.url.S",
          [`${format}Url.$`]: `$.existingArticle.Item.${format}.M.${format}Url.S`,
          success: true,
        },
      });
      const skipPublish = new Choice(this, `SkipPublish`);
      skipPublish.when(
        Condition.and(
          Condition.isPresent(`$.existingArticle.Item.${format}.M.status.S`),
          Condition.stringEquals(
            `$.existingArticle.Item.${format}.M.status.S`,
            "succeeded"
          )
        ),
        skipped
      );
      const transform = new LambdaInvoke(this, `Transform`, {
        lambdaFunction: parsePostFn,
        payload: TaskInput.fromObject({
          ...(canonical ? {
            "canonical.$": `$.canonical[0].${canonical}Url`,
          } : {}),
          "post.$": "$.content",
          "articleCatalog.$": "$.catalog.Items",
          format,
        }),
        retryOnServiceExceptions: true,
        outputPath: '$.Payload',
      });
      skipPublish.otherwise(transform);
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
            "#status": format,
          },
          expressionAttributeValues: {
            ":status": DynamoAttributeValue.fromMap({
              status: DynamoAttributeValue.fromString("failed"),
            }),
          },
          resultPath: JsonPath.DISCARD,
        }
      );
      transform.addCatch(updateArticleRecordFailure);
      const failed = new Pass(this, `Failed`, {
        parameters: {
          success: false,
        },
      });
      updateArticleRecordFailure.next(failed);
      const publish = new LambdaInvoke(this, `Publish`, {
        lambdaFunction: sendApiRequestFn,
        payload: publishPayload,
        retryOnServiceExceptions: true,
        resultPath: '$.result',
      });
      transform.next(publish);
      publish.addCatch(updateArticleRecordFailure);
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
          updateExpression: "SET #format = :format, #url = :url",
          expressionAttributeNames: {
            "#format": format,
            "#url": "url",
          },
          expressionAttributeValues: {
            ':format': DynamoAttributeValue.fromMap({
              status: DynamoAttributeValue.fromString("succeeded"),
              [`${format}Url`]: DynamoAttributeValue.fromString(
                format === "hashnode"
                  ? JsonPath.stringAt(
                      `States.Format('${hashnodeBlogUrl}/{}', $.result.Payload.data.createPublicationStory.post.slug)`
                    )
                  : JsonPath.stringAt(`$.result.Payload.url`)
              ),
            }),
            ":url": DynamoAttributeValue.fromString(JsonPath.stringAt("$.url")),
          },
          resultPath: JsonPath.DISCARD,
        }
      );
      publish.next(updateArticleRecordSuccess);
      const success = new Pass(this, `Success`, {
        parameters: {
          "url.$": "$.url",
          [`${format}Url.$`]:
            format === "hashnode"
              ? `States.Format('${hashnodeBlogUrl}/{}', $.result.Payload.data.createPublicationStory.post.slug)`
              : "$.result.Payload.url",
          success: true,
        },
      });
      updateArticleRecordSuccess.next(success);

      this.startState = skipPublish;
      this.endStates = [skipped, failed, success];
    }
}
