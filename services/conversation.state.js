import redis from "../config/redis.js";

// One active multi-step flow per user: { intent: "transfer" | "electricity" | ..., step, ...data }.
// Starting a new flow replaces the old one, so a reply like a meter number always
// reaches the flow that asked for it.

const key = (from) => `conv:${from}`;
const DEFAULT_TTL_SECONDS = 1800;

export async function getState(from) {
  const raw = await redis.get(key(from));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    await redis.del(key(from));
    return null;
  }
}

export const setState = (from, state, ttl = DEFAULT_TTL_SECONDS) => redis.setEx(key(from), ttl, JSON.stringify(state));

export const clearState = (from) => redis.del(key(from));
