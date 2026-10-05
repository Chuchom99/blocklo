// Tests never read the developer's real .env secrets.
process.env.NODE_ENV = "test";
process.env.DOTENV_CONFIG_PATH = "tests/.env.test-does-not-exist";
process.env.PAYMENTS_ENABLED = "true";
process.env.WHATSAPP_PAYMENT_FLOW_ID = "payment-flow-id";
process.env.WHATSAPP_REGISTRATION_FLOW_ID = "registration-flow-id";
process.env.PSB_ENV = "production";
process.env.WEBHOOK_USERNAME = "psb-webhook";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
process.env.WHATSAPP_ACCESS_TOKEN = "access-token";
process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
