import crypto from "crypto";
import config from "../config/env.js";
import logger from "../config/logger.js";
import { safeEqual } from "../utils/crypto.js";

// Verifies Meta's X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret).
// Without this anyone could POST a fake message "from" any customer's number.
// `failStatus` lets the Flow endpoint answer with Meta's expected 432.
export const verifyMetaSignature = (failStatus = 401) => (req, res, next) => {
  const header = req.get("x-hub-signature-256") || "";
  if (!req.rawBody || !header.startsWith("sha256=")) {
    logger.warn(`[META] missing signature on ${req.originalUrl}`);
    return res.sendStatus(failStatus);
  }
  const expected = crypto.createHmac("sha256", config.whatsapp.appSecret).update(req.rawBody).digest("hex");
  if (!safeEqual(header.slice(7), expected)) {
    logger.warn(`[META] bad signature on ${req.originalUrl}`);
    return res.sendStatus(failStatus);
  }
  next();
};
