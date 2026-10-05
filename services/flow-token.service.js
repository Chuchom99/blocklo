import redis from "../config/redis.js";
import { hmac, randomToken, safeEqual } from "../utils/crypto.js";
import { normalizeMsisdn } from "../utils/phone.js";

// flow_token = "<type>.<id>.<sig>", sig = HMAC(type.id.waId).
// The token is the only identity the Flow endpoint trusts: it binds the Flow to
// one WhatsApp user and (for payments) one payment intent.

const REG_TTL_SECONDS = 3600;
const sign = (type, id, waId) => hmac(`flow:${type}.${id}.${normalizeMsisdn(waId)}`).slice(0, 32);

export function issuePaymentToken(intentId, waId) {
  return `pay.${intentId}.${sign("pay", intentId, waId)}`;
}

export async function issueRegistrationToken(waId) {
  const nonce = randomToken(16);
  await redis.setEx(`flow:reg:${nonce}`, REG_TTL_SECONDS, normalizeMsisdn(waId));
  return `reg.${nonce}.${sign("reg", nonce, waId)}`;
}

export function parseToken(token) {
  const [type, id, sig, ...rest] = String(token ?? "").split(".");
  if (rest.length || !["pay", "reg"].includes(type) || !id || !sig) return null;
  return { type, id, sig };
}

// For payment tokens the caller supplies the waId of the intent's owner.
export const verifyPaymentToken = ({ id, sig }, ownerWaId) =>
  Boolean(ownerWaId) && safeEqual(sig, sign("pay", id, ownerWaId));

// Returns the bound waId, or null if the token is unknown, expired or forged.
export async function resolveRegistrationToken({ id, sig }) {
  const waId = await redis.get(`flow:reg:${id}`);
  if (!waId || !safeEqual(sig, sign("reg", id, waId))) return null;
  return waId;
}

export const consumeRegistrationToken = ({ id }) => redis.del(`flow:reg:${id}`);
