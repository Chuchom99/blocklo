require('dotenv').config();

module.exports = {
  port: process.env.PORT || 5000,
  env: process.env.NODE_ENV || 'development',

  db: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL,
  },

  ninepsb: {
    baseUrl: process.env.NINEPSB_BASE_URL,
    clientId: process.env.NINEPSB_CLIENT_ID,
    clientSecret: process.env.NINEPSB_CLIENT_SECRET,
    apiKey: process.env.NINEPSB_API_KEY,
    webhookSecret: process.env.NINEPSB_WEBHOOK_SECRET,
  },

  llm: {
    provider: process.env.LLM_PROVIDER,
    openrouterKey: process.env.OPENROUTER_API_KEY,
    deepseekKey: process.env.DEEPSEEK_API_KEY,
  },

  security: {
    jwtSecret: process.env.JWT_SECRET,
    encryptionKey: process.env.ENCRYPTION_KEY,
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
