import crypto from "crypto";
import logger from "../config/logger.js";

export const requestId = (req, res, next) => {
  req.id = crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
};

export const notFoundHandler = (req, res) => res.status(404).json({ success: false, message: "Not found" });

// Internal error details are logged, never sent to the client.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ success: false, message: "Request too large" });
  if (err.type === "entity.parse.failed") return res.status(400).json({ success: false, message: "Invalid JSON" });

  if (err.expose && err.status) {
    return res.status(err.status).json({ success: false, message: err.message, code: err.code });
  }

  logger.error(`[${req.id}] ${req.method} ${req.originalUrl}: ${err.message}`, err);
  res.status(500).json({ success: false, message: "Something went wrong", requestId: req.id });
};
