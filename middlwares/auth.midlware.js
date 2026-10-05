import config from "../config/env.js";
import logger from "../config/logger.js";
import { safeEqual } from "../utils/crypto.js";

const { username, password, allowedIps } = config.psb.webhook;

// HTTP Basic auth for 9PSB's webhook, plus an optional source-IP allowlist.
export const basicAuth = (req, res, next) => {
  if (allowedIps.length && !allowedIps.includes(req.ip)) {
    logger.warn(`[PSB WEBHOOK] rejected source IP ${req.ip}`);
    return res.status(403).json({ error: "Forbidden" });
  }

  const header = req.get("authorization") || "";
  if (!header.startsWith("Basic ")) return res.status(401).json({ error: "Unauthorized" });

  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  const user = sep === -1 ? "" : decoded.slice(0, sep);
  const pass = sep === -1 ? "" : decoded.slice(sep + 1);

  // Evaluate both comparisons so timing doesn't reveal which part was wrong.
  const userOk = safeEqual(user, username);
  const passOk = safeEqual(pass, password);
  if (userOk && passOk) return next();

  logger.warn(`[PSB WEBHOOK] invalid credentials from ${req.ip}`);
  return res.status(401).json({ error: "Unauthorized" });
};
