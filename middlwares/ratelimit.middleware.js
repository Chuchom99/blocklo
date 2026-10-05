import { hit } from "../utils/rateLimit.js";

// rateLimit({ name: "login", max: 5, windowSec: 900, key: (req) => req.body.identifier })
// Counts by client IP plus an optional extra key (e.g. the account being targeted).
export const rateLimit = ({ name, max, windowSec, key }) => async (req, res, next) => {
  const extra = key ? String(key(req) ?? "").toLowerCase().slice(0, 100) : "";
  const { allowed } = await hit(`${name}:${req.ip}:${extra}`, max, windowSec);
  if (!allowed) {
    res.set("Retry-After", String(windowSec));
    return res.status(429).json({ success: false, message: "Too many requests. Please try again later." });
  }
  next();
};
