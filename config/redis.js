// import { createClient } from "redis";
// import dotenv from "dotenv";

// dotenv.config();

// const client = createClient({
//   url: process.env.REDIS_URL,
//   tls: {},
// });

// client.on("connect", () => console.log("✅ Connected to Redis Cloud"));
// client.on("error", (err) => console.error("Redis Error:", err));

// await client.connect();



import { createClient } from "redis";

const client = createClient({
    url: process.env.REDIS_URL,
    socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
    },
});

client.on('error', (err) => console.error('Redis Error:', err));
client.on('connect', () => console.log('Connected to Redis Cloud'));

await client.connect();

export default client;
