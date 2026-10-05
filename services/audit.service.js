import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import { redactObject } from "../utils/redact.js";

// Append-only security/audit trail. Never throws: auditing must not break the request.
export async function audit(actor, action, { target, ip, metadata } = {}) {
  try {
    await prisma.auditLog.create({
      data: { actor: String(actor), action, target, ip, metadata: metadata ? redactObject(metadata) : undefined },
    });
  } catch (err) {
    logger.error(`[AUDIT] failed to record ${action}: ${err.message}`);
  }
}
