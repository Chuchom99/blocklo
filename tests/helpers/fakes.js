import { jest } from "@jest/globals";
import crypto from "crypto";

// Minimal in-memory stand-ins so tests run without Postgres/Redis.

const matchValue = (actual, cond) => {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    if ("in" in cond) return cond.in.includes(actual);
    if ("gt" in cond) return actual > cond.gt;
    if ("gte" in cond) return actual >= cond.gte;
    if ("lt" in cond) return actual < cond.lt;
    if ("lte" in cond) return actual <= cond.lte;
    if ("equals" in cond) return actual === cond.equals;
  }
  return actual === cond;
};
const OPERATORS = ["in", "gt", "gte", "lt", "lte", "equals"];
const matches = (row, where = {}) =>
  Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return cond.some((w) => matches(row, w));
    // Compound unique keys, e.g. { userId_alias: { userId, alias } }
    if (k.includes("_") && cond && typeof cond === "object" && !Object.keys(cond).some((c) => OPERATORS.includes(c))) {
      return matches(row, cond);
    }
    return matchValue(row[k], cond);
  });

const applyData = (row, data) => {
  for (const [k, v] of Object.entries(data)) {
    row[k] = v && typeof v === "object" && "increment" in v ? (row[k] ?? 0) + v.increment : v;
  }
  row.updatedAt = new Date();
  return row;
};

export function makeTable(defaults = () => ({}), relations = {}) {
  const rows = [];
  const out = (row, include) => {
    if (!row) return null;
    const copy = { ...row };
    for (const key of Object.keys(include || {})) if (relations[key]) copy[key] = relations[key](row);
    return copy;
  };
  return {
    rows,
    create: jest.fn(async ({ data }) => {
      if (data.reference && rows.some((r) => r.reference === data.reference)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row = { id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...defaults(), ...data };
      rows.push(row);
      return { ...row };
    }),
    findUnique: jest.fn(async ({ where, include }) => out(rows.find((r) => matches(r, where)), include)),
    findFirst: jest.fn(async ({ where, include } = {}) => out(rows.find((r) => matches(r, where)), include)),
    findMany: jest.fn(async ({ where, include } = {}) => rows.filter((r) => matches(r, where)).map((r) => out(r, include))),
    count: jest.fn(async ({ where } = {}) => rows.filter((r) => matches(r, where)).length),
    update: jest.fn(async ({ where, data }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error("Record not found");
      return { ...applyData(row, data) };
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const hits = rows.filter((r) => matches(r, where));
      hits.forEach((r) => applyData(r, data));
      return { count: hits.length };
    }),
    aggregate: jest.fn(async ({ where, _sum }) => {
      const hits = rows.filter((r) => matches(r, where));
      const field = Object.keys(_sum)[0];
      return { _sum: { [field]: hits.length ? hits.reduce((s, r) => s + Number(r[field]), 0) : null } };
    }),
    deleteMany: jest.fn(async ({ where }) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
      return { count: before - rows.length };
    }),
  };
}

export function makePrisma() {
  const prisma = {};
  const byId = (table, field) => (row) => {
    const hit = prisma[table].rows.find((r) => r.id === row[field]);
    return hit ? { ...hit } : null;
  };
  const many = (table, field) => (row) => prisma[table].rows.filter((r) => r[field] === row.id).map((r) => ({ ...r }));
  Object.assign(prisma, {
    user: makeTable(() => ({ pinFailedCount: 0, pinLockedUntil: null, status: "ACTIVE", kycLevel: 1 }), {
      accounts: many("account", "userId"),
    }),
    account: makeTable(() => ({}), { user: byId("user", "userId") }),
    transaction: makeTable(() => ({ status: "PENDING", requeryCount: 0, needsReview: false }), {
      user: byId("user", "userId"),
      account: byId("account", "accountId"),
    }),
    paymentIntent: makeTable(() => ({ status: "DRAFT", channel: "whatsapp" }), {
      user: byId("user", "userId"),
      account: byId("account", "accountId"),
      transaction: (row) => {
        const hit = prisma.transaction.rows.find((t) => t.intentId === row.id);
        return hit ? { ...hit } : null;
      },
    }),
    beneficiary: makeTable(),
    session: makeTable(() => ({ revokedAt: null })),
    auditLog: makeTable(),
  });
  prisma.$transaction = jest.fn(async (ops) => Promise.all(ops));
  return prisma;
}

export function makeRedis() {
  const store = new Map();
  const live = (k) => {
    const e = store.get(k);
    if (e && e.exp && e.exp < Date.now()) store.delete(k);
    return store.get(k);
  };
  return {
    store,
    get: jest.fn(async (k) => live(k)?.v ?? null),
    set: jest.fn(async (k, v, opts = {}) => {
      if (opts.NX && live(k)) return null;
      const ttl = opts.EX ? opts.EX * 1000 : opts.PX;
      store.set(k, { v: String(v), exp: ttl ? Date.now() + ttl : null });
      return "OK";
    }),
    setEx: jest.fn(async (k, sec, v) => store.set(k, { v: String(v), exp: Date.now() + sec * 1000 })),
    del: jest.fn(async (k) => (store.delete(k) ? 1 : 0)),
    incr: jest.fn(async (k) => {
      const n = Number(live(k)?.v ?? 0) + 1;
      store.set(k, { v: String(n), exp: live(k)?.exp ?? null });
      return n;
    }),
    expire: jest.fn(async (k, sec) => {
      const e = live(k);
      if (e) e.exp = Date.now() + sec * 1000;
      return 1;
    }),
    eval: jest.fn(async (_script, { keys, arguments: args }) => {
      if (live(keys[0])?.v === args[0]) store.delete(keys[0]);
      return 1;
    }),
  };
}

export const makeQueue = () => ({ add: jest.fn(async () => ({})), upsertJobScheduler: jest.fn() });

export function makeQueueModule() {
  return {
    connection: {},
    QUEUES: { WHATSAPP_INBOUND: "whatsapp-inbound", PAYMENTS: "payments", PSB_WEBHOOK: "psb-webhook", MAINTENANCE: "maintenance" },
    whatsappInboundQueue: makeQueue(),
    paymentsQueue: makeQueue(),
    psbWebhookQueue: makeQueue(),
    maintenanceQueue: makeQueue(),
  };
}

// Mock the infrastructure modules. Call before importing anything under test.
export function mockInfra({ prisma = makePrisma(), redis = makeRedis(), queues = makeQueueModule() } = {}) {
  jest.unstable_mockModule("../../config/prisma.js", () => ({ default: prisma }));
  jest.unstable_mockModule("../../config/redis.js", () => ({ default: redis }));
  jest.unstable_mockModule("../../config/queue.js", () => queues);
  return { prisma, redis, queues };
}
