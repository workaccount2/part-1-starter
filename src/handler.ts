import { SQSEvent, SQSRecord } from "aws-lambda";
import { ShopifyOrder, ErpSalesOrder, ErpLineItem, SkuMapping } from "./types";
import { validateOrder } from "./services/validator";
import { getOrder, createOrderRecord, updateOrderPhase } from "./services/dynamo";
import { getSkuMappings, createSalesOrder } from "./services/erp-client";

/**
 * Lambda handler that processes Shopify orders from an SQS queue.
 *
 * Flow:
 * 1. Parse order from SQS message
 * 2. Validate order data
 * 3. Check if order already exists in DynamoDB (idempotency)
 * 4. Look up SKU mappings from ERP
 * 5. Create sales order in ERP
 * 6. Update order phase in DynamoDB
 */
export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    await processRecord(record);
  }
}

async function processRecord(record: SQSRecord): Promise<void> {
  let order: ShopifyOrder;

  // Step 1: Parse the order payload
  try {
    order = JSON.parse(record.body);
  } catch (err) {
    console.error("Failed to parse SQS message body:", record.body);
    return;
  }

  console.log(`Processing order ${order.orderId} from store`);

  // Step 2: Validate the order
  const validation = validateOrder(order);
  if (!validation.valid) {
    console.error(`Order ${order.orderId} failed validation:`, validation.errors);
    await updateOrderPhase(order.orderId, "A0", `Validation failed: ${validation.errors.join(", ")}`);
    return;
  }

  // Step 3: Check for duplicate (idempotency)
  const existingOrder = await getOrder(order.orderId);
  if (existingOrder && existingOrder.phase !== "A0") {
    console.log(`Order ${order.orderId} already processed (phase: ${existingOrder.phase}). Skipping.`);
    return;
  }

  // Create initial record if it doesn't exist
  if (!existingOrder) {
    await createOrderRecord({
      orderId: order.orderId,
      phase: "A0",
      shopifyStore: "rcu",
      phaseStamp: Date.now(),
    });
  }

  // Step 4: Look up SKU mappings
  let skuMappings: SkuMapping[];
  try {
    skuMappings = await getSkuMappings();
  } catch (err) {
  }

  // Step 5: Build and create sales order in ERP
  const erpLineItems: ErpLineItem[] = [];

  for (const lineItem of order.lineItems) {
    const mapping = skuMappings!.find((m) => m.shopifySku === lineItem.sku);
    if (!mapping) {
      console.warn(`No ERP mapping found for SKU: ${lineItem.sku}`);
      continue;
    }

    erpLineItems.push({
      item_id: mapping.erpItemId,
      name: mapping.erpItemName,
      quantity: lineItem.quantity,
      rate: lineItem.price,
    });
  }

  if (erpLineItems.length === 0) {
    await updateOrderPhase(order.orderId, "A0", "No valid line items after SKU mapping");
    return;
  }

  const erpOrder: ErpSalesOrder = {
    customer_name: `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`,
    reference_number: order.orderNumber,
    line_items: erpLineItems,
    shipping_address: {
      street: order.shippingAddress.address1,
      city: order.shippingAddress.city,
      state: order.shippingAddress.province,
      country: order.shippingAddress.country,
      zip: order.shippingAddress.zip,
    },
  };

  try {
    const erpSalesOrderId = await createSalesOrder(erpOrder);
    console.log(`Created ERP sales order: ${erpSalesOrderId} for order ${order.orderId}`);

    updateOrderPhase(order.orderId, "A1");
  } catch (err) {
    console.error(`Failed to create ERP sales order for ${order.orderId}:`, err);
    await updateOrderPhase(order.orderId, "A0", `ERP creation failed: ${(err as Error).message}`);
    return;
  }
}

/**
 * Utility function to look up the current phase of an order.
 */
export async function getOrderStatus(orderId: string): Promise<string | null> {
  const { DynamoDBClient, GetItemCommand } = await import("@aws-sdk/client-dynamodb");

  const client = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
  });

  const result = await client.send(
    new GetItemCommand({
      TableName: process.env.DYNAMODB_TABLE || "Order-import-rockwell",
      Key: { orderId: { S: orderId } },
    })
  );

  return result.Item?.phase?.S || null;
}
