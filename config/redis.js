import { createClient } from "redis";
import config from "./env.js";
import logger from "./logger.js";

const client = createClient({
  url: config.redis.url,
  socket: {
    connectTimeout: 10000,
    reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
  },
});

client.on("error", (err) => logger.error(`Redis error: ${err.message}`));

await client.connect();

export default client;
