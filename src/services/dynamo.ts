import { DynamoDBClient, PutItemCommand, UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { OrderRecord, OrderPhase } from "../types";

const TABLE_NAME = process.env.DYNAMODB_TABLE || "Order-import-rockwell";

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  // When pointed at a local endpoint (DynamoDB Local), use static dummy
  // credentials. In production there is no endpoint, so the Lambda's IAM role
  // is used instead.
  ...(process.env.DYNAMODB_ENDPOINT && {
    endpoint: process.env.DYNAMODB_ENDPOINT,
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  }),
});

export async function getOrder(orderId: string): Promise<OrderRecord | null> {
  const result = await client.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        orderId: { S: orderId },
      },
    })
  );

  if (!result.Item) return null;

  return {
    orderId: result.Item.orderId.S!,
    phase: result.Item.phase.S!,
    shopifyStore: result.Item.shopifyStore.S!,
    phaseStamp: Number(result.Item.phaseStamp.N!),
    errorMessage: result.Item.errorMessage?.S,
  };
}

export async function createOrderRecord(record: OrderRecord): Promise<void> {
  await client.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        orderId: { S: record.orderId },
        phase: { S: record.phase },
        shopifyStore: { S: record.shopifyStore },
        phaseStamp: { N: String(record.phaseStamp) },
      },
    })
  );
}

export async function updateOrderPhase(
  orderId: string,
  phase: OrderPhase,
  errorMessage?: string
): Promise<void> {
  const updateExpression = errorMessage
    ? "SET phase = :phase, phaseStamp = :stamp, errorMessage = :err"
    : "SET phase = :phase, phaseStamp = :stamp";

  const expressionValues: Record<string, any> = {
    ":phase": { S: phase },
    ":stamp": { N: String(Date.now()) },
  };

  if (errorMessage) {
    expressionValues[":err"] = { S: errorMessage };
  }

  await client.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: {
        orderId: { S: orderId },
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionValues,
    })
  );
}
