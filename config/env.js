import dotenv from "dotenv";
import Joi from "joi";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

const isTest = process.env.NODE_ENV === "test";
const isProd = process.env.NODE_ENV === "production";

// In tests every secret gets a throwaway default so modules can load without a .env.
const secret = () =>
  isTest ? Joi.string().default("test-secret-test-secret-test-secret!") : Joi.string().min(32).required();
const required = () => (isTest ? Joi.string().allow("").default("") : Joi.string().required());
const optional = () => Joi.string().allow("").default("");

// 9PSB credentials and tokens must never travel over plain HTTP in production.
const psbUrl = () => (isProd ? Joi.string().uri({ scheme: ["https"] }).required() : required());

const csv = (value) =>
  (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const schema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().default(5000),
  LOG_LEVEL: Joi.string().valid("error", "warn", "info", "http", "debug").default("info"),
  CORS_ORIGINS: optional(),
  PUBLIC_BASE_URL: Joi.string().uri().default("http://localhost:5000"),
  PAYMENTS_ENABLED: Joi.boolean().truthy("true").falsy("false").default(false),
  RUN_WORKERS: Joi.boolean().truthy("true").falsy("false").default(true),

  DATABASE_URL: required(),
  DIRECT_URL: required(), // used by `prisma migrate`; must be the non-pooled endpoint
  REDIS_URL: required(),

  PSB_ENV: Joi.string().valid("sandbox", "production").default("sandbox"),
  PSB_BASE_URL: psbUrl(),
  PSB_VAS_BASE_URL: psbUrl(),
  PSB_IDENTITY_BASE_URL: psbUrl(),
  PSB_WAAS_USERNAME: required(),
  PSB_WAAS_PASSWORD: required(),
  PSB_WAAS_CLIENT_ID: required(),
  PSB_WAAS_CLIENT_SECRET: required(),
  PSB_VAS_API_KEY: required(),
  PSB_VAS_SECRET_KEY: required(),
  WEBHOOK_USERNAME: required(),
  WEBHOOK_PASSWORD: isTest ? Joi.string().default("test-webhook-password") : Joi.string().min(16).required(),
  PSB_WEBHOOK_IPS: optional(),

  DEEPSEEK_API_KEY: required(),

  WHATSAPP_ACCESS_TOKEN: required(),
  WHATSAPP_APP_SECRET: isTest ? Joi.string().default("test-app-secret") : Joi.string().min(16).required(),
  WHATSAPP_VERIFY_TOKEN: required(),
  WHATSAPP_PHONE_NUMBER_ID: required(),
  WHATSAPP_REGISTRATION_FLOW_ID: optional(),
  WHATSAPP_PAYMENT_FLOW_ID: optional(),
  WHATSAPP_FLOW_PRIVATE_KEY_PATH: optional(),
  WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE: optional(),

  JWT_SECRET: secret(),
  ENCRYPTION_KEY: isTest
    ? Joi.string().default(Buffer.alloc(32, 7).toString("base64"))
    : Joi.string().base64().required(),
  HMAC_KEY: secret(),
  ADMIN_API_KEY: secret(),
  ADMIN_IPS: optional(),
}).unknown(true);

const { value: env, error } = schema.validate(process.env, { abortEarly: false });

if (error) {
  // Fail fast: a fintech backend must not boot with missing or weak secrets.
  const problems = error.details.map((d) => `  - ${d.message}`).join("\n");
  console.error(`Invalid environment configuration:\n${problems}`);
  process.exit(1);
}

const encryptionKey = Buffer.from(env.ENCRYPTION_KEY, "base64");
if (encryptionKey.length !== 32) {
  console.error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  process.exit(1);
}

const config = {
  env: env.NODE_ENV,
  isProd,
  isTest,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  corsOrigins: csv(env.CORS_ORIGINS),
  publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, ""),
  paymentsEnabled: env.PAYMENTS_ENABLED,
  runWorkers: env.RUN_WORKERS,

  db: { url: env.DATABASE_URL },
  redis: { url: env.REDIS_URL },

  psb: {
    env: env.PSB_ENV,
    isSandbox: env.PSB_ENV === "sandbox",
    baseUrl: env.PSB_BASE_URL,
    vasBaseUrl: env.PSB_VAS_BASE_URL.trim(),
    identityBaseUrl: env.PSB_IDENTITY_BASE_URL,
    waas: {
      username: env.PSB_WAAS_USERNAME,
      password: env.PSB_WAAS_PASSWORD,
      clientId: env.PSB_WAAS_CLIENT_ID,
      clientSecret: env.PSB_WAAS_CLIENT_SECRET,
    },
    vas: { apiKey: env.PSB_VAS_API_KEY, secretKey: env.PSB_VAS_SECRET_KEY },
    webhook: {
      username: env.WEBHOOK_USERNAME,
      password: env.WEBHOOK_PASSWORD,
      allowedIps: csv(env.PSB_WEBHOOK_IPS),
    },
  },

  llm: { deepseekKey: env.DEEPSEEK_API_KEY },

  whatsapp: {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    appSecret: env.WHATSAPP_APP_SECRET,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    registrationFlowId: env.WHATSAPP_REGISTRATION_FLOW_ID,
    paymentFlowId: env.WHATSAPP_PAYMENT_FLOW_ID,
    flowPrivateKeyPath: env.WHATSAPP_FLOW_PRIVATE_KEY_PATH,
    flowPrivateKeyPassphrase: env.WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE,
    graphUrl: "https://graph.facebook.com/v21.0",
  },

  security: {
    jwtSecret: env.JWT_SECRET,
    encryptionKey,
    hmacKey: env.HMAC_KEY,
    adminApiKey: env.ADMIN_API_KEY,
    adminIps: csv(env.ADMIN_IPS),
  },
};

export default config;
