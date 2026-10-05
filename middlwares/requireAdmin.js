import config from "../config/env.js";
import logger from "../config/logger.js";
import { audit } from "../services/audit.service.js";
import { safeEqual } from "../utils/crypto.js";

const { adminApiKey, adminIps } = config.security;

// Ops-only routes: X-Admin-Key plus (optionally) a source-IP allowlist. Every call is audited.
export async function requireAdmin(req, res, next) {
  if (adminIps.length && !adminIps.includes(req.ip)) {
    logger.warn(`[ADMIN] rejected IP ${req.ip}`);
    return res.status(404).json({ success: false, message: "Not found" });
  }
  if (!safeEqual(req.get("x-admin-key") || "", adminApiKey)) {
    logger.warn(`[ADMIN] bad key from ${req.ip}`);
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  await audit("admin", `admin.${req.method.toLowerCase()} ${req.baseUrl}${req.path}`, { ip: req.ip, metadata: req.body });
  next();
}
