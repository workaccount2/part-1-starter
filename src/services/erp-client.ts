import { ErpSalesOrder, SkuMapping } from "../types";

const ERP_BASE_URL = process.env.ERP_API_URL || "https://erp-api.example.com";
const ERP_API_KEY = process.env.ERP_API_KEY || "";

/**
 * Fetches all SKU mappings from the ERP system.
 * The ERP returns mappings in pages of 50.
 */
export async function getSkuMappings(): Promise<SkuMapping[]> {
  const allMappings: SkuMapping[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(`${ERP_BASE_URL}/item-mappings?page=${page}&per_page=50`, {
      headers: {
        Authorization: `Bearer ${ERP_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`ERP API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { mappings: SkuMapping[] };
    allMappings.push(...data.mappings);
    // note: this variable check if the fetch return items more than 50
    // note continue: there issue with this comparison, the fetch request for 50 items, if the API return 50 items, then the comparison will be "false"
    // note continue: The while loop will stop and page 2 will never be fetched. 
    // note continue: this will result in missing products, therefore missing needed data that might be need in the future and code crashing in the production.
    // note continue: to fix the error, I change the comparison to greater or equal
    hasMore = data.mappings.length >= 50;

    page++;
  }

  return allMappings;
}

/**
 * Creates a sales order in the ERP system.
 * Returns the ERP sales order ID on success.
 */
export async function createSalesOrder(order: ErpSalesOrder): Promise<string> {
  const response = await fetch(`${ERP_BASE_URL}/sales-orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ERP_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(order),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to create sales order: ${response.status} - ${errorBody}`);
  }

  const result = (await response.json()) as { salesOrderId: string };
  return result.salesOrderId;
}
