import winston from "winston";
import path from "path";
import { fileURLToPath } from "url";
import config from "./env.js";
import { redactObject, redactText } from "../utils/redact.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "../logs");

const { createLogger, format, transports } = winston;

// Redact the message and any extra metadata before anything is written.
const redact = format((info) => {
  info.message = redactText(typeof info.message === "string" ? info.message : JSON.stringify(info.message));
  const splat = info[Symbol.for("splat")];
  if (Array.isArray(splat) && splat.length) {
    info.meta = redactObject(splat.length === 1 ? splat[0] : splat);
  }
  return info;
});

const line = format.printf(({ level, message, timestamp, meta }) => {
  const extra = meta === undefined ? "" : ` ${typeof meta === "string" ? meta : JSON.stringify(meta)}`;
  return `${timestamp} [${level.toUpperCase()}]: ${message}${extra}`;
});

const logger = createLogger({
  level: config.logLevel,
  format: format.combine(redact(), format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), line),
  silent: config.isTest,
  transports: [
    new transports.Console(),
    new transports.File({ filename: path.join(LOG_DIR, "error.log"), level: "error" }),
    new transports.File({ filename: path.join(LOG_DIR, "app.log") }),
  ],
});

export default logger;
