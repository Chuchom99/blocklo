import redis from "../config/redis.js";
import { randomToken } from "./crypto.js";

const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

// Run fn while holding a Redis lock, waiting up to waitMs to acquire it.
// Used to process one user's messages and payments strictly one at a time.
export async function withLock(key, fn, { ttlMs = 60_000, waitMs = 30_000 } = {}) {
  const token = randomToken(12);
  const deadline = Date.now() + waitMs;
  while (!(await redis.set(key, token, { NX: true, PX: ttlMs }))) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${key}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE, { keys: [key], arguments: [token] });
  }
}
