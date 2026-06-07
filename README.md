# Rockwell Razors — Order Processor (Technical Test Part 1)

## Overview

This is a simplified version of our order processing Lambda function. It receives Shopify orders from an SQS queue, validates them, maps SKUs to our ERP system, creates sales orders, and updates the order status in DynamoDB.

**The function has 3 bugs.** Your job is to find and fix all of them.

## Setup

### Prerequisites

- Node.js 18+ and npm/pnpm
- Docker and Docker Compose

### Install Dependencies

```bash
npm install
```

### Start Local Services

```bash
docker compose up -d
```

This starts:
- **DynamoDB Local** on port 8000
- **Mock ERP API** on port 3001

The DynamoDB table is created automatically the first time you run the tests, so there is nothing else to set up.

### Environment Variables (optional)

The test suite already defaults to the local services above, so you can run `npm test` straight after `docker compose up -d`. If your local ports differ, override them in your shell:

```bash
export DYNAMODB_ENDPOINT=http://localhost:8000
export ERP_API_URL=http://localhost:3001
```

### Run Tests

```bash
npm test
```

Several tests will fail. That's expected — the bugs are causing them to fail. The two validation tests should pass out of the box; the order-processing tests will start passing as you fix the bugs.

## Your Assignment

1. Find and fix all 3 bugs
2. Make all tests pass
3. For each bug, add a 2–3 sentence comment explaining what it was, what it would cause in production, and how you found it

## File Structure

```
src/
├── handler.ts          ← Main Lambda handler (bugs are here)
├── services/
│   ├── dynamo.ts       ← DynamoDB operations
│   ├── erp-client.ts   ← ERP API client (bug is here too)
│   └── validator.ts    ← Order validation
└── types.ts            ← Type definitions

tests/
├── handler.test.ts     ← Test suite
└── fixtures/           ← Sample order payloads
```
