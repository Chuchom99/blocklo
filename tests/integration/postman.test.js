import { jest } from "@jest/globals";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import request from "supertest";
import { mockInfra } from "../helpers/fakes.js";

// Replays tests/postman/blocklo-api.postman_collection.json in order against the
// real app (infrastructure and 9PSB mocked), running the collection's own
// pre-request and test scripts. Proves every payload passes server validation
// and every script works.

const COLLECTION = JSON.parse(fs.readFileSync("tests/postman/blocklo-api.postman_collection.json", "utf8"));
const ENVIRONMENT = JSON.parse(fs.readFileSync("tests/postman/blocklo-local.postman_environment.json", "utf8"));

// Flow keypair so the encrypted Flow request can be built with scripts/flow-request.js.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flow-"));
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
fs.writeFileSync(path.join(dir, "priv.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
fs.writeFileSync(path.join(dir, "pub.pem"), publicKey.export({ type: "spki", format: "pem" }));
process.env.WHATSAPP_FLOW_PRIVATE_KEY_PATH = path.join(dir, "priv.pem");

const { prisma } = mockInfra();
// Outbound WhatsApp calls go nowhere; the real Flow decryption still runs.
jest.unstable_mockModule("axios", () => ({ default: Object.assign(jest.fn(async () => ({ data: {} })), { post: jest.fn(async () => ({ data: {} })) }) }));
jest.unstable_mockModule("../../services/psb.service.js", () => ({
  default: {
    getBalance: jest.fn(async () => 500_000),
    otherBankEnquiry: jest.fn(async () => "JOHN DOE"),
    getBanks: jest.fn(async () => [{ bankName: "Guaranty Trust Bank", bankCode: "058" }]),
    walletEnquiry: jest.fn(async () => ({ status: "SUCCESS" })),
    getWalletStatus: jest.fn(async () => ({ status: "SUCCESS" })),
    changeWalletStatus: jest.fn(async () => ({ status: "SUCCESS" })),
    getWalletByBVN: jest.fn(async () => ({})),
    getTransactionHistory: jest.fn(async () => ({ status: "SUCCESS" })),
    notificationRequery: jest.fn(async () => ({ status: "SUCCESS" })),
    singleWalletTransfer: jest.fn(async () => ({ outcome: "SUCCESS", raw: {} })),
    requeryTransaction: jest.fn(async () => ({ outcome: "UNKNOWN", raw: null })),
  },
  OUTCOME: { SUCCESS: "SUCCESS", FAILED: "FAILED", UNKNOWN: "UNKNOWN" },
  classifyResponse: jest.fn(),
  classifyStatusQuery: jest.fn(),
}));
jest.unstable_mockModule("../../services/psb.vas.services.js", () => ({
  default: {
    detectNetwork: jest.fn(async () => ({ name: "MTN" })),
    getDataPlans: jest.fn(async () => [{ productId: "MTN-1GB-30", size: "1GB", price: 1000, validity: "30 days" }]),
    getCategoryBillers: jest.fn(async (id) => ({
      data: id === "1" ? [{ id: "BP-IKEJA", name: "Ikeja Electric" }] : [{ id: "CW-DSTV", name: "DSTV" }],
    })),
    getBillerFields: jest.fn(async () => ({ data: [{ fieldName: "itemId", items: [{ itemId: "COMPE36", itemName: "Compact", amount: "15700" }] }] })),
    validatePayment: jest.fn(async () => ({ data: { customerName: "METER OWNER" } })),
    getTopupStatus: jest.fn(),
    getBillStatus: jest.fn(),
  },
}));

const { default: app } = await import("../../app.js");
const { default: config } = await import("../../config/env.js");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// --- minimal Postman sandbox -------------------------------------------------
const env = new Map(ENVIRONMENT.values.map((v) => [v.key, v.value]));
env.set("adminApiKey", config.security.adminApiKey);
env.set("psbWebhookUsername", config.psb.webhook.username);
env.set("psbWebhookPassword", config.psb.webhook.password);
env.set("whatsappAppSecret", config.whatsapp.appSecret);
env.set("whatsappVerifyToken", config.whatsapp.verifyToken);
env.set("tvItemId", "COMPE36");
env.set("transactionReference", "ref-postman-1");

const vars = new Map();
const replaceIn = (s) => s.replace(/\{\{([^}]+)\}\}/g, (m, k) => (vars.has(k) ? vars.get(k) : env.has(k) ? env.get(k) : m));

const CryptoJS = {
  HmacSHA256: (msg, key) => ({ toString: () => crypto.createHmac("sha256", key).update(msg).digest("hex") }),
  enc: { Hex: "hex" },
};

function run(script, ctx) {
  const failures = [];
  const expect = (actual) => ({
    to: {
      be: { oneOf: (list) => { if (!list.includes(actual)) throw new Error(`${actual} not in [${list}]`); } },
      eql: (want) => { if (JSON.stringify(actual) !== JSON.stringify(want)) throw new Error(`${actual} != ${want}`); },
    },
  });
  const pm = {
    environment: { get: (k) => env.get(k), set: (k, v) => env.set(k, v) },
    variables: { get: (k) => vars.get(k) ?? env.get(k), set: (k, v) => vars.set(k, v), replaceIn },
    request: ctx.request,
    response: ctx.response,
    expect,
    test: (name, fn) => { try { fn(); } catch (e) { failures.push(`${name}: ${e.message}`); } },
  };
  new Function("pm", "CryptoJS", script.join("\n"))(pm, CryptoJS);
  return failures;
}

const flatten = (items, prefix = "") =>
  items.flatMap((i) => (i.item ? flatten(i.item, `${prefix}${i.name} / `) : [{ ...i, fullName: prefix + i.name }]));

// -----------------------------------------------------------------------------

test("every request in the Postman collection succeeds with its payload", async () => {
  // Real encrypted Flow ping, produced by the helper script the collection points to.
  const out = execFileSync(process.execPath, ["scripts/flow-request.js", "encrypt", path.join(dir, "pub.pem"), '{"version":"3.0","action":"ping"}'], { encoding: "utf8" });
  env.set("flowEncryptedBody", out.split("\n").find((l) => l.startsWith("{")));

  const results = [];
  for (const item of flatten(COLLECTION.item)) {
    // After registering, simulate the wallet job finishing so the user can pay.
    if (item.fullName === "Auth / Login") {
      const user = prisma.user.rows[0];
      user.status = "ACTIVE";
      user.whatsappId = env.get("waFrom");
      const account = await prisma.account.create({ data: { userId: user.id, accountNumber: env.get("walletAccount") } });
      await prisma.transaction.create({
        data: { userId: user.id, accountId: account.id, type: "DEBIT", kind: "TRANSFER", amount: 5000, reference: "ref-postman-1", status: "UNKNOWN" },
      });
    }

    const r = item.request;
    const ctx = { request: { body: { raw: r.body?.raw ?? "" }, headers: { list: {}, upsert(h) { this.list[h.key] = h.value; } } } };
    vars.clear();
    for (const e of item.event.filter((e) => e.listen === "prerequest")) run(e.script.exec, ctx);

    const url = replaceIn(r.url.raw).replace(env.get("baseUrl"), "");
    let call = request(app)[r.method.toLowerCase()](url);
    for (const h of r.header) call = call.set(h.key, replaceIn(h.value));
    for (const [k, v] of Object.entries(ctx.request.headers.list)) call = call.set(k, v);

    const auth = r.auth ?? COLLECTION.auth;
    if (auth.type === "bearer") call = call.set("Authorization", `Bearer ${replaceIn(auth.bearer[0].value)}`);
    if (auth.type === "basic") {
      const get = (k) => replaceIn(auth.basic.find((b) => b.key === k).value);
      call = call.auth(get("username"), get("password"));
    }
    if (r.body) call = call.set("Content-Type", "application/json").send(replaceIn(ctx.request.body.raw));

    const res = await call;
    const response = { code: res.status, json: () => res.body, text: () => res.text };
    const failures = item.event.filter((e) => e.listen === "test").flatMap((e) => run(e.script.exec, { request: ctx.request, response }));
    results.push({ name: item.fullName, status: res.status, failures, body: failures.length ? res.text.slice(0, 200) : "" });
  }

  const failed = results.filter((r) => r.failures.length);
  if (failed.length) console.log(failed);
  expect(failed).toEqual([]);
  expect(results).toHaveLength(43);
});
