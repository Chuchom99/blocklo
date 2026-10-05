import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import config from "../config/env.js";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import { audit } from "./audit.service.js";
import { randomToken, sha256 } from "../utils/crypto.js";

const ACCESS_TTL = "15m";
const REFRESH_TTL_MS = 30 * 24 * 3600_000;
const JWT_OPTS = { algorithm: "HS256", issuer: "blocklo-api", audience: "blocklo-app" };

const signAccess = (userId, sessionId) =>
  jwt.sign({ sid: sessionId }, config.security.jwtSecret, { ...JWT_OPTS, subject: userId, expiresIn: ACCESS_TTL });

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.security.jwtSecret, { ...JWT_OPTS, algorithms: ["HS256"] });
  } catch {
    return null;
  }
}

async function issue(userId, familyId, { ip, userAgent }) {
  const refreshToken = randomToken(32);
  const session = await prisma.session.create({
    data: {
      userId,
      familyId,
      refreshHash: sha256(refreshToken),
      ip,
      userAgent: userAgent?.slice(0, 200),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return { accessToken: signAccess(userId, session.id), refreshToken, expiresIn: 900, sessionId: session.id };
}

export const startSession = (userId, meta) => issue(userId, uuidv4(), meta);

// Rotate a refresh token. Presenting an already-rotated token means it was stolen
// (or replayed), so the whole session family is revoked.
export async function refresh(refreshToken, meta) {
  const session = await prisma.session.findUnique({ where: { refreshHash: sha256(refreshToken || "") } });
  if (!session || session.expiresAt <= new Date()) return null;

  if (session.revokedAt) {
    await prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    logger.warn(`[AUTH] refresh token reuse detected for user ${session.userId}`);
    await audit(session.userId, "auth.refresh_reuse", { ip: meta.ip, target: session.familyId });
    return null;
  }

  const { count } = await prisma.session.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) return null; // lost a race with a concurrent refresh

  const next = await issue(session.userId, session.familyId, meta);
  await prisma.session.update({ where: { id: session.id }, data: { replacedBy: next.sessionId } });
  return next;
}

export async function isSessionActive(sessionId) {
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { revokedAt: true, expiresAt: true } });
  return Boolean(session && !session.revokedAt && session.expiresAt > new Date());
}

export async function logout(sessionId) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return;
  await prisma.session.updateMany({ where: { familyId: session.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}
