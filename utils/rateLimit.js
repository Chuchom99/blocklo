import redis from "../config/redis.js";
import logger from "../config/logger.js";

// Fixed-window counter. Fails open if Redis is unavailable: rate limiting is a
// brake, the real controls (PIN lockout, auth) live in the database.
export async function hit(key, max, windowSec) {
  try {
    const k = `rl:${key}`;
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSec);
    return { allowed: count <= max, count };
  } catch (err) {
    logger.warn(`[RATE] limiter unavailable: ${err.message}`);
    return { allowed: true, count: 0 };
  }
}
