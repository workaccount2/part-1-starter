// Runs before the test modules are imported. Provides sane local defaults so
// `npm test` works right after `docker compose up -d` without having to export
// anything by hand. Anything you set in your own shell still wins.

// Talk only to the local stack: if you have a real AWS profile configured, the
// SDK would otherwise prefer it over the local dummy credentials below.
delete process.env.AWS_PROFILE;
delete process.env.AWS_SDK_LOAD_CONFIG;

process.env.DYNAMODB_ENDPOINT ||= "http://localhost:8000";
process.env.DYNAMODB_TABLE ||= "Order-import-rockwell";
process.env.ERP_API_URL ||= "http://localhost:3001";
process.env.ERP_API_KEY ||= "test-api-key";
process.env.AWS_REGION ||= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ||= "local";
process.env.AWS_SECRET_ACCESS_KEY ||= "local";
