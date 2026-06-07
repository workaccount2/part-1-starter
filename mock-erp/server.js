// Mock ERP API for the Rockwell technical test.
//
// Stands in for the real ERP system the order processor talks to. Zero
// dependencies on purpose — it runs in a bare `node:20-alpine` container
// (see docker-compose.yml) with no `npm install` step, so it can only use
// Node built-ins.
//
// Endpoints used by src/services/erp-client.ts:
//   GET  /item-mappings?page=N&per_page=50   -> { mappings: [...] }
//   POST /sales-orders                       -> { salesOrderId: "SO-..." }
//
// Test-control endpoints (used by the test suite, not by the handler):
//   POST /__control/reset                    -> clears recorded sales orders + flags
//   POST /__control/fail-mappings?on=1|0     -> make /item-mappings return 500
//   GET  /__control/sales-orders             -> the sales orders received so far

const http = require("http");

const PORT = process.env.PORT || 3001;
const PER_PAGE = 50;

// --- SKU mapping catalogue, deliberately spread across pages -----------------
// Page 1 is exactly full (50 rows) so it sits right on the pagination boundary.
// The "boundary" SKU below lives only on page 2 — an order that needs it will
// fail unless every page is fetched, which is what the final-page test checks.
const COMMON_MAPPINGS = [
  { shopifySku: "RW-6S-SS", erpItemId: "ERP-001", erpItemName: "Rockwell 6S Razor" },
  { shopifySku: "RW-100B", erpItemId: "ERP-002", erpItemName: "Rockwell Blades 100pk" },
  { shopifySku: "RW-STAND-SS", erpItemId: "ERP-003", erpItemName: "Rockwell Stand SS" },
  { shopifySku: "RW-T2-CHR", erpItemId: "ERP-004", erpItemName: "Rockwell T2 Chrome" },
];

// Pad page 1 out to exactly 50 rows with throwaway filler mappings.
const FILLER_MAPPINGS = Array.from({ length: PER_PAGE - COMMON_MAPPINGS.length }, (_, i) => ({
  shopifySku: `RW-FILLER-${i + 1}`,
  erpItemId: `ERP-F${i + 1}`,
  erpItemName: `Filler Item ${i + 1}`,
}));

const PAGE_1 = [...COMMON_MAPPINGS, ...FILLER_MAPPINGS]; // exactly 50 rows
const PAGE_2 = [
  { shopifySku: "RW-LASTPAGE-SS", erpItemId: "ERP-LP1", erpItemName: "Rockwell Last-Page Razor" },
]; // < 50 rows -> this is the final page

function mappingsForPage(page) {
  if (page === 1) return PAGE_1;
  if (page === 2) return PAGE_2;
  return [];
}

// --- mutable test state ------------------------------------------------------
let failMappings = false;
let salesOrders = [];

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // Health check
  if (method === "GET" && (path === "/" || path === "/health")) {
    return send(res, 200, { status: "ok" });
  }

  // --- ERP endpoints the handler talks to ---
  if (method === "GET" && path === "/item-mappings") {
    if (failMappings) {
      return send(res, 500, { error: "ERP item-mappings service is unavailable" });
    }
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    return send(res, 200, { mappings: mappingsForPage(page) });
  }

  if (method === "POST" && path === "/sales-orders") {
    const order = await readBody(req);
    const salesOrderId = `SO-${Date.now()}-${salesOrders.length + 1}`;
    salesOrders.push({ salesOrderId, ...order });
    return send(res, 200, { salesOrderId });
  }

  // --- test-control endpoints ---
  if (method === "POST" && path === "/__control/reset") {
    failMappings = false;
    salesOrders = [];
    return send(res, 200, { ok: true });
  }

  if (method === "POST" && path === "/__control/fail-mappings") {
    failMappings = url.searchParams.get("on") === "1";
    return send(res, 200, { failMappings });
  }

  if (method === "GET" && path === "/__control/sales-orders") {
    return send(res, 200, { salesOrders });
  }

  return send(res, 404, { error: `No route for ${method} ${path}` });
});

server.listen(PORT, () => {
  console.log(`Mock ERP API listening on http://0.0.0.0:${PORT}`);
});
