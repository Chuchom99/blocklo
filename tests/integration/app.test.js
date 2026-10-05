import { jest } from "@jest/globals";
import crypto from "crypto";
import request from "supertest";
import { mockInfra } from "../helpers/fakes.js";

const { prisma, queues } = mockInfra();
jest.unstable_mockModule("../../services/whatsapp.services.js", () => ({
  default: { sendFlow: jest.fn(), sendReply: jest.fn(), sendMessage: jest.fn(async () => true) },
}));

const { default: app } = await import("../../app.js");
const { default: config } = await import("../../config/env.js");
const { startSession } = await import("../../services/auth.service.js");

const sign = (body) => `sha256=${crypto.createHmac("sha256", config.whatsapp.appSecret).update(body).digest("hex")}`;
const waMessage = (id, from = "2348012345678") =>
  JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from, type: "text", text: { body: "send 5000 to 0123456789 gtb" } }] } }] }] });

beforeEach(() => {
  for (const t of Object.values(prisma)) if (t.rows) t.rows.length = 0;
  jest.clearAllMocks();
});

describe("WhatsApp webhook", () => {
  test("rejects unsigned requests (spoofed sender)", async () => {
    const res = await request(app).post("/api/whatsapp/webhook").set("Content-Type", "application/json").send(waMessage("m1"));
    expect(res.status).toBe(401);
    expect(queues.whatsappInboundQueue.add).not.toHaveBeenCalled();
  });

  test("rejects a bad signature", async () => {
    const body = waMessage("m1");
    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body + "x"))
      .send(body);
    expect(res.status).toBe(401);
  });

  test("accepts a signed message and queues it exactly once across redeliveries", async () => {
    const body = waMessage("m-dup");
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/whatsapp/webhook")
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", sign(body))
        .send(body);
      expect(res.status).toBe(200);
    }
    expect(queues.whatsappInboundQueue.add).toHaveBeenCalledTimes(1);
  });

  test("verification uses the verify token, not the access token", async () => {
    const ok = await request(app).get("/api/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" });
    expect(ok.text).toBe("42");
    const bad = await request(app).get("/api/whatsapp/webhook").query({ "hub.mode": "subscribe", "hub.verify_token": "access-token", "hub.challenge": "42" });
    expect(bad.status).toBe(403);
  });

  test("Flow endpoint rejects unsigned requests with 432", async () => {
    const res = await request(app).post("/api/whatsapp/flow").send({ encrypted_flow_data: "x", encrypted_aes_key: "y", initial_vector: "z" });
    expect(res.status).toBe(432);
  });
});

describe("removed public money routes", () => {
  test.each([
    ["post", "/api/psb/wallet/debit"],
    ["post", "/api/psb/wallet/credit"],
    ["post", "/api/psb/wallet/to-other-banks"],
    ["post", "/api/psb/wallet/change-status"],
    ["post", "/api/psb/vas/topup/airtime"],
    ["post", "/api/psb/vas/billspayment/pay"],
    ["post", "/api/wallet/debit"],
    ["post", "/api/ai/message"],
    ["post", "/debug/flush-redis"],
    ["post", "/api/users/verify-pin"],
    ["get", "/receipts/receipt_1764891798736.pdf"],
  ])("%s %s -> 404", async (method, path) => {
    expect((await request(app)[method](path).send({})).status).toBe(404);
  });
});

describe("REST auth", () => {
  test("user routes require a token", async () => {
    expect((await request(app).get("/api/me/balance")).status).toBe(401);
  });

  test("a token signed with another secret is rejected", async () => {
    const jwt = (await import("jsonwebtoken")).default;
    const forged = jwt.sign({ sid: "s" }, "not-the-secret", { subject: "u1", issuer: "blocklo-api", audience: "blocklo-app" });
    expect((await request(app).get("/api/me/balance").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
  });

  test("users can't read each other's payments (IDOR)", async () => {
    const alice = await prisma.user.create({ data: { firstName: "A", lastName: "A", email: "a@x.ng" } });
    const bob = await prisma.user.create({ data: { firstName: "B", lastName: "B", email: "b@x.ng" } });
    const intent = await prisma.paymentIntent.create({ data: { userId: alice.id, kind: "TRANSFER", amount: 10, summary: "x", expiresAt: new Date() } });
    const { accessToken } = await startSession(bob.id, {});
    const res = await request(app).get(`/api/me/payments/${intent.id}`).set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });

  test("logout revokes the session immediately", async () => {
    const u = await prisma.user.create({ data: { firstName: "C", lastName: "C", email: "c@x.ng" } });
    const { accessToken } = await startSession(u.id, {});
    const auth = { Authorization: `Bearer ${accessToken}` };
    expect((await request(app).get("/api/users/me").set(auth)).status).toBe(200);
    await request(app).post("/api/users/logout").set(auth);
    expect((await request(app).get("/api/users/me").set(auth)).status).toBe(401);
  });

  test("register never returns hashes or identity numbers, and ignores whatsappId", async () => {
    const res = await request(app).post("/api/users/register").send({
      email: "new@x.ng", phone: "08031234567", password: "a-long-password", firstName: "New", lastName: "User",
      pin: "2580", termsAgreed: true, gender: 1, dateOfBirth: "01/01/1990", address: "1 Marina, Lagos",
      bvn: "22222222222", whatsappId: "+2348099999999",
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/22222222222|\$2[ab]\$|transactionPin|password/);
    expect(prisma.user.rows[0].whatsappId).toBeNull();
    expect(prisma.user.rows[0].bvnEnc).toBeTruthy();
    expect(prisma.user.rows[0].bvn).toBeUndefined();
  });

  test("login gives the same answer for unknown user and wrong password", async () => {
    const unknown = await request(app).post("/api/users/login").send({ identifier: "nobody@x.ng", password: "whatever-pass" });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe("Invalid credentials");
  });
});

describe("admin routes", () => {
  test("require the admin key", async () => {
    expect((await request(app).get("/api/admin/transactions/review")).status).toBe(401);
    expect((await request(app).get("/api/admin/transactions/review").set("X-Admin-Key", "wrong")).status).toBe(401);
    const ok = await request(app).get("/api/admin/transactions/review").set("X-Admin-Key", config.security.adminApiKey);
    expect(ok.status).toBe(200);
    expect(prisma.auditLog.rows.length).toBe(1);
  });
});

describe("9PSB webhook", () => {
  const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;

  test("requires correct basic auth (no hardcoded fallback)", async () => {
    const url = "/webhook/9psb/webhook";
    expect((await request(app).post(url).send({})).status).toBe(401);
    expect((await request(app).post(url).set("Authorization", basic("blocklo_webhook", "y5#K9mPx!2vN8qL")).send({})).status).toBe(401);
    const ok = await request(app).post(url).set("Authorization", basic("psb-webhook", config.psb.webhook.password)).send({ transactionReference: "r1" });
    expect(ok.status).toBe(200);
    expect(queues.psbWebhookQueue.add).toHaveBeenCalledTimes(1);
  });
});

describe("error handling", () => {
  test("malformed JSON gets a clean 400", async () => {
    const res = await request(app).post("/api/users/login").set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.js/);
  });

  test("oversized bodies are rejected", async () => {
    const res = await request(app).post("/api/users/login").send({ identifier: "x".repeat(200_000), password: "y" });
    expect(res.status).toBe(413);
  });
});
