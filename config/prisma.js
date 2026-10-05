import pkg from "@prisma/client";
import config from "./env.js";

const { PrismaClient } = pkg;

// Query logging can include PII in parameters, so only enable it locally.
const log = config.env === "development" ? ["query", "warn", "error"] : ["warn", "error"];

const prisma = globalThis.__prisma ?? new PrismaClient({ log });
if (!config.isProd) globalThis.__prisma = prisma;

export default prisma;
