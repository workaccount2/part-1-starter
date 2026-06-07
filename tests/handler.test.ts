import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { SQSEvent } from "aws-lambda";
import { handler, getOrderStatus } from "../src/handler";
import { validateOrder } from "../src/services/validator";
import validOrder from "./fixtures/valid-order.json";
import multiItemOrder from "./fixtures/multi-item-order.json";
import invalidOrder from "./fixtures/invalid-order.json";
import paginationOrder from "./fixtures/pagination-order.json";

const TABLE_NAME = process.env.DYNAMODB_TABLE || "Order-import-rockwell";
const ERP_URL = process.env.ERP_API_URL || "http://localhost:3001";

const ddb = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(process.env.DYNAMODB_ENDPOINT && {
    endpoint: process.env.DYNAMODB_ENDPOINT,
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  }),
});

// Order ids touched by the handler tests — cleared before each run so the
// suite is repeatable (including in watch mode).
const TEST_ORDER_IDS = [
  "RCU-AWAIT",
  "RCU-ERPFAIL",
  "RCU-PAGE",
  "RCU-MULTI",
  "RCU-IDEM",
];

// --- helpers -----------------------------------------------------------------

function buildSqsEvent(orders: object[]): SQSEvent {
  return {
    Records: orders.map((order, i) => ({
      messageId: `msg-${i}`,
      receiptHandle: `handle-${i}`,
      body: JSON.stringify(order),
      attributes: {} as any,
      messageAttributes: {},
      md5OfBody: "",
      eventSource: "aws:sqs",
      eventSourceARN: "arn:aws:sqs:us-east-1:123456789:orders",
      awsRegion: "us-east-1",
    })),
  };
}

async function ensureTable(): Promise<void> {
  try {
    await ddb.send(
      new CreateTableCommand({
        TableName: TABLE_NAME,
        AttributeDefinitions: [{ AttributeName: "orderId", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "orderId", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      })
    );
  } catch (err: any) {
    // Table already exists from a previous run — fine.
    if (err?.name !== "ResourceInUseException") throw err;
  }
}

async function deleteOrder(orderId: string): Promise<void> {
  await ddb.send(
    new DeleteItemCommand({ TableName: TABLE_NAME, Key: { orderId: { S: orderId } } })
  );
}

async function resetMockErp(): Promise<void> {
  await fetch(`${ERP_URL}/__control/reset`, { method: "POST" });
}

async function setErpMappingsFailure(on: boolean): Promise<void> {
  await fetch(`${ERP_URL}/__control/fail-mappings?on=${on ? 1 : 0}`, { method: "POST" });
}

async function getMockSalesOrders(): Promise<any[]> {
  const res = await fetch(`${ERP_URL}/__control/sales-orders`);
  const body = (await res.json()) as { salesOrders: any[] };
  return body.salesOrders;
}

beforeAll(async () => {
  await ensureTable();
});

beforeEach(async () => {
  await resetMockErp();
  await Promise.all(TEST_ORDER_IDS.map(deleteOrder));
});

// ============================================================================
// VALIDATION (pure function — these pass out of the box)
// ============================================================================

describe("Order validation", () => {
  test("valid order passes validation", () => {
    const result = validateOrder(validOrder as any);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("invalid order fails with the expected errors", () => {
    const result = validateOrder(invalidOrder as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing orderId");
    expect(result.errors).toContain("Invalid or missing email");
    expect(result.errors).toContain("Order has no line items");
    expect(result.errors).toContain("Total price must be greater than zero");
  });
});

// ============================================================================
// ORDER PROCESSING (integration — DynamoDB Local + mock ERP must be running)
// These tests fail until the bugs in handler.ts / erp-client.ts are fixed.
// ============================================================================

describe("Order processing handler", () => {
  test("waits for the post-ERP phase update to finish before returning", async () => {
    // A correctly written handler must not return until the phase update that
    // follows a successful ERP create has completed. We slow that specific
    // update down: if the handler awaits it, the flag is set by the time
    // handler() resolves; if it fires-and-forgets, handler() resolves first.
    const dynamo = require("../src/services/dynamo");
    const realUpdate = dynamo.updateOrderPhase;
    let a1Completed = false;

    const spy = jest
      .spyOn(dynamo, "updateOrderPhase")
      .mockImplementation(async (...args: any[]) => {
        const result = await realUpdate(...args);
        if (args[1] === "A1") {
          await new Promise((r) => setTimeout(r, 75));
          a1Completed = true;
        }
        return result;
      });

    try {
      await handler(buildSqsEvent([{ ...validOrder, orderId: "RCU-AWAIT" }]));
      expect(a1Completed).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("surfaces ERP mapping-fetch failures instead of masking them", async () => {
    // When the ERP mappings call fails, the handler must not silently swallow
    // the error and then crash on undefined data. Either re-throwing the real
    // ERP error or parking the order at A0 with that error is acceptable — what
    // is NOT acceptable is a generic "cannot read property of undefined" crash.
    await setErpMappingsFailure(true);

    let rejected: Error | null = null;
    await handler(buildSqsEvent([{ ...validOrder, orderId: "RCU-ERPFAIL" }])).catch(
      (e) => (rejected = e as Error)
    );

    if (rejected) {
      expect((rejected as Error).message).not.toMatch(/Cannot read|undefined|not a function/i);
      expect((rejected as Error).message).toMatch(/erp/i);
    } else {
      const phase = await getOrderStatus("RCU-ERPFAIL");
      expect(phase).toBe("A0");
    }
  });

  test("fetches every page of SKU mappings, including a full final-page boundary", async () => {
    // This order's SKU only exists on the second page of ERP mappings. Page 1
    // is exactly full (50 rows). If pagination stops one page early, the SKU is
    // never found and no ERP sales order is created.
    await handler(buildSqsEvent([{ ...paginationOrder, orderId: "RCU-PAGE" }]));

    const salesOrders = await getMockSalesOrders();
    const created = salesOrders.some((o) =>
      o.line_items.some((li: any) => li.item_id === "ERP-LP1")
    );
    expect(created).toBe(true);
  });

  test("processes all line items in a multi-item order", async () => {
    await handler(buildSqsEvent([{ ...multiItemOrder, orderId: "RCU-MULTI" }]));

    const salesOrders = await getMockSalesOrders();
    expect(salesOrders).toHaveLength(1);
    expect(salesOrders[0].line_items).toHaveLength(3);
  });

  test("does not throw on a malformed SQS message body", async () => {
    const event: SQSEvent = {
      Records: [
        {
          messageId: "msg-bad",
          receiptHandle: "handle-bad",
          body: "this is not valid json{{{",
          attributes: {} as any,
          messageAttributes: {},
          md5OfBody: "",
          eventSource: "aws:sqs",
          eventSourceARN: "arn:aws:sqs:us-east-1:123456789:orders",
          awsRegion: "us-east-1",
        },
      ],
    };
    await expect(handler(event)).resolves.not.toThrow();
  });

  test("skips orders that have already been processed (idempotency)", async () => {
    const event = buildSqsEvent([{ ...validOrder, orderId: "RCU-IDEM" }]);
    await handler(event);
    await handler(event);

    // The second pass should short-circuit on the existing non-A0 phase, so
    // only one ERP sales order is ever created.
    const salesOrders = await getMockSalesOrders();
    expect(salesOrders).toHaveLength(1);
  });
});
