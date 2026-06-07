import { ShopifyOrder } from "../types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a Shopify order payload before processing.
 */
export function validateOrder(order: ShopifyOrder): ValidationResult {
  const errors: string[] = [];

  if (!order.orderId || order.orderId.trim() === "") {
    errors.push("Missing orderId");
  }

  if (!order.orderNumber || order.orderNumber.trim() === "") {
    errors.push("Missing orderNumber");
  }

  if (!order.email || !order.email.includes("@")) {
    errors.push("Invalid or missing email");
  }

  if (!order.lineItems || order.lineItems.length === 0) {
    errors.push("Order has no line items");
  }

  if (order.lineItems) {
    for (const item of order.lineItems) {
      if (!item.sku || item.sku.trim() === "") {
        errors.push(`Line item "${item.title}" has no SKU`);
      }
      if (item.quantity <= 0) {
        errors.push(`Line item "${item.title}" has invalid quantity: ${item.quantity}`);
      }
      if (item.price < 0) {
        errors.push(`Line item "${item.title}" has negative price: ${item.price}`);
      }
    }
  }

  if (!order.shippingAddress) {
    errors.push("Missing shipping address");
  }

  if (order.totalPrice <= 0) {
    errors.push("Total price must be greater than zero");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
