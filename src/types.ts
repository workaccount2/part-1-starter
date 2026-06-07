export interface ShopifyOrder {
  orderId: string;
  orderNumber: string;
  email: string;
  totalPrice: number;
  currency: string;
  lineItems: LineItem[];
  shippingAddress: ShippingAddress;
  createdAt: string;
}

export interface LineItem {
  sku: string;
  title: string;
  quantity: number;
  price: number;
}

export interface ShippingAddress {
  firstName: string;
  lastName: string;
  address1: string;
  city: string;
  province: string;
  country: string;
  zip: string;
}

export interface ErpSalesOrder {
  customer_name: string;
  reference_number: string;
  line_items: ErpLineItem[];
  shipping_address: {
    street: string;
    city: string;
    state: string;
    country: string;
    zip: string;
  };
}

export interface ErpLineItem {
  item_id: string;
  name: string;
  quantity: number;
  rate: number;
}

export interface SkuMapping {
  shopifySku: string;
  erpItemId: string;
  erpItemName: string;
}

export interface OrderRecord {
  orderId: string;
  phase: string;
  shopifyStore: string;
  phaseStamp: number;
  errorMessage?: string;
}

export type OrderPhase = "A0" | "A1" | "A2" | "A3" | "A4" | "A5";
