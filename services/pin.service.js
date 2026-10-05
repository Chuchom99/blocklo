import bcrypt from "bcryptjs";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import { PIN_POLICY } from "../utils/constant.js";
import { audit } from "./audit.service.js";

const SALT_ROUNDS = 12;

// Rejects PINs that are easy to guess: all-same digits and straight sequences.
export function validateNewPin(pin) {
  if (!/^\d{4}$/.test(String(pin ?? ""))) return "PIN must be exactly 4 digits.";
  const digits = String(pin).split("").map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  if (new Set(digits).size === 1) return "PIN can't be the same digit repeated.";
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return "PIN can't be a sequence like 1234.";
  return null;
}

export const hashPin = (pin) => bcrypt.hash(String(pin), SALT_ROUNDS);

// Verify a transaction PIN with lockout.
// Returns { ok: true } or { ok: false, reason: "NO_PIN" | "LOCKED" | "WRONG", remaining?, lockedUntil? }.
export async function verifyPin(userId, pin) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { transactionPin: true, pinFailedCount: true, pinLockedUntil: true },
  });
  if (!user?.transactionPin) return { ok: false, reason: "NO_PIN" };
  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    return { ok: false, reason: "LOCKED", lockedUntil: user.pinLockedUntil };
  }

  if (await bcrypt.compare(String(pin ?? ""), user.transactionPin)) {
    if (user.pinFailedCount > 0 || user.pinLockedUntil) {
      await prisma.user.update({ where: { id: userId }, data: { pinFailedCount: 0, pinLockedUntil: null } });
    }
    return { ok: true };
  }

  // Atomic increment so parallel guesses can't exceed the limit.
  const { pinFailedCount } = await prisma.user.update({
    where: { id: userId },
    data: { pinFailedCount: { increment: 1 } },
    select: { pinFailedCount: true },
  });

  if (pinFailedCount >= PIN_POLICY.maxAttempts) {
    const lockedUntil = new Date(Date.now() + PIN_POLICY.lockMinutes * 60_000);
    await prisma.user.update({ where: { id: userId }, data: { pinFailedCount: 0, pinLockedUntil: lockedUntil } });
    logger.warn(`[PIN] user ${userId} locked until ${lockedUntil.toISOString()}`);
    await audit(userId, "pin.locked", { metadata: { lockedUntil } });
    return { ok: false, reason: "LOCKED", lockedUntil };
  }

  return { ok: false, reason: "WRONG", remaining: PIN_POLICY.maxAttempts - pinFailedCount };
}
