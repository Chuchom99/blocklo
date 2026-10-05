import { jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import { mockInfra } from "../helpers/fakes.js";

const { prisma, queues } = mockInfra();

const calls = [];
const PsbService = {
  getBalance: jest.fn(async () => 1_000_000),
  walletToOtherBanks: jest.fn(async () => {
    calls.push({ step: "provider", ledger: prisma.transaction.rows.map((r) => r.status) });
    return { outcome: "SUCCESS", providerRef: "p1", raw: { status: "SUCCESS" } };
  }),
};
jest.unstable_mockModule("../../services/psb.service.js", () => ({
  default: PsbService,
  OUTCOME: { SUCCESS: "SUCCESS", FAILED: "FAILED", UNKNOWN: "UNKNOWN" },
}));
const PsbVasService = { getDataPlans: jest.fn(async () => []), buyData: jest.fn(), buyAirtime: jest.fn(), payBill: jest.fn() };
jest.unstable_mockModule("../../services/psb.vas.services.js", () => ({ default: PsbVasService }));
const WhatsAppService = { sendFlow: jest.fn(), sendReply: jest.fn() };
jest.unstable_mockModule("../../services/whatsapp.services.js", () => ({ default: WhatsAppService }));

const PI = await import("../../services/payment-intent.service.js");

const PIN = "2580";
let user;
let account;

beforeEach(async () => {
  for (const t of Object.values(prisma)) if (t.rows) t.rows.length = 0;
  calls.length = 0;
  jest.clearAllMocks();
  user = await prisma.user.create({
    data: { firstName: "Ada", lastName: "Obi", whatsappId: "2348012345678", transactionPin: await bcrypt.hash(PIN, 4), kycLevel: 2 },
  });
  account = await prisma.account.create({ data: { userId: user.id, accountNumber: "1100000001" } });
});

const transfer = { accountNumber: "0123456789", bankCode: "058", bankName: "GTBank", accountName: "JOHN DOE" };
const draftTransfer = (amount = 5000) =>
  PI.draft({ user, account, kind: "TRANSFER", amount, payload: transfer, summary: "Send to JOHN DOE" });

describe("draft", () => {
  test("creates a DRAFT and moves no money", async () => {
    const intent = await draftTransfer();
    expect(intent.status).toBe("DRAFT");
    expect(PsbService.walletToOtherBanks).not.toHaveBeenCalled();
    expect(prisma.transaction.rows).toHaveLength(0);
  });

  test("enforces the per-transaction tier limit", async () => {
    await expect(draftTransfer(150_000)).rejects.toMatchObject({ code: "LIMIT_PER_TX" });
  });

  test("enforces the daily limit including pending and unknown transactions", async () => {
    await prisma.transaction.create({ data: { userId: user.id, type: "DEBIT", status: "UNKNOWN", amount: 150_000, reference: "r-old" } });
    await expect(draftTransfer(60_000)).rejects.toMatchObject({ code: "LIMIT_DAILY" });
  });

  test("rejects when the balance is known to be too low", async () => {
    PsbService.getBalance.mockResolvedValueOnce(100);
    await expect(draftTransfer(5000)).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
  });

  test("rejects amounts with more than 2 decimals", async () => {
    await expect(draftTransfer(10.555)).rejects.toMatchObject({ code: "BAD_AMOUNT" });
  });

  test("a new draft cancels the previous open one", async () => {
    const first = await draftTransfer();
    await draftTransfer(6000);
    expect((await prisma.paymentIntent.findUnique({ where: { id: first.id } })).status).toBe("CANCELLED");
  });
});

describe("authorize", () => {
  test("wrong PIN does not authorize and reports attempts left", async () => {
    const intent = await draftTransfer();
    const r = await PI.authorize({ intentId: intent.id, userId: user.id, pin: "9999" });
    expect(r).toMatchObject({ ok: false, reason: "WRONG", remaining: 4 });
    expect(queues.paymentsQueue.add).not.toHaveBeenCalled();
  });

  test("locks after 5 wrong PINs, and then even the right PIN is refused", async () => {
    const intent = await draftTransfer();
    for (let i = 0; i < 4; i++) await PI.authorize({ intentId: intent.id, userId: user.id, pin: "9999" });
    const fifth = await PI.authorize({ intentId: intent.id, userId: user.id, pin: "9999" });
    expect(fifth.reason).toBe("LOCKED");
    const right = await PI.authorize({ intentId: intent.id, userId: user.id, pin: PIN });
    expect(right.reason).toBe("LOCKED");
    expect(queues.paymentsQueue.add).not.toHaveBeenCalled();
  });

  test("correct PIN authorizes exactly once; a replay is rejected", async () => {
    const intent = await draftTransfer();
    expect((await PI.authorize({ intentId: intent.id, userId: user.id, pin: PIN })).ok).toBe(true);
    expect((await PI.authorize({ intentId: intent.id, userId: user.id, pin: PIN })).reason).toBe("ALREADY_USED");
    expect(queues.paymentsQueue.add).toHaveBeenCalledTimes(1);
    expect(queues.paymentsQueue.add.mock.calls[0][2]).toMatchObject({ jobId: intent.id, attempts: 1 });
  });

  test("another user cannot authorize my intent", async () => {
    const intent = await draftTransfer();
    expect((await PI.authorize({ intentId: intent.id, userId: "someone-else", pin: PIN })).reason).toBe("NOT_FOUND");
  });

  test("an expired intent cannot be authorized", async () => {
    const intent = await draftTransfer();
    prisma.paymentIntent.rows[0].expiresAt = new Date(Date.now() - 1000);
    expect((await PI.authorize({ intentId: intent.id, userId: user.id, pin: PIN })).reason).toBe("EXPIRED");
  });
});

describe("execute", () => {
  const authorized = async () => {
    const intent = await draftTransfer();
    await PI.authorize({ intentId: intent.id, userId: user.id, pin: PIN });
    return intent;
  };

  test("writes the PENDING ledger row before calling 9PSB, then settles it", async () => {
    const intent = await authorized();
    await PI.execute(intent.id);
    expect(calls).toEqual([{ step: "provider", ledger: ["PENDING"] }]);
    const tx = prisma.transaction.rows[0];
    expect(tx).toMatchObject({ status: "SUCCESS", reference: intent.idempotencyKey, intentId: intent.id });
    expect(PsbService.walletToOtherBanks.mock.calls[0][0].reference).toBe(intent.idempotencyKey);
  });

  test("running the same job twice pays once", async () => {
    const intent = await authorized();
    await PI.execute(intent.id);
    await PI.execute(intent.id);
    expect(PsbService.walletToOtherBanks).toHaveBeenCalledTimes(1);
  });

  test("a rejected transfer is recorded and reported as FAILED, not success", async () => {
    PsbService.walletToOtherBanks.mockResolvedValueOnce({ outcome: "FAILED", raw: { status: "FAILED" } });
    const intent = await authorized();
    await PI.execute(intent.id);
    expect(prisma.transaction.rows[0].status).toBe("FAILED");
    expect(WhatsAppService.sendReply.mock.calls[0][1].text).toMatch(/failed/i);
  });

  test("a timeout leaves the row UNKNOWN for reconciliation", async () => {
    PsbService.walletToOtherBanks.mockResolvedValueOnce({ outcome: "UNKNOWN", raw: null });
    const intent = await authorized();
    await PI.execute(intent.id);
    expect(prisma.transaction.rows[0].status).toBe("UNKNOWN");
    expect(WhatsAppService.sendReply.mock.calls[0][1].text).toMatch(/processing/i);
  });

  test("a DRAFT (never authorized) intent is never executed", async () => {
    const intent = await draftTransfer();
    await PI.execute(intent.id);
    expect(PsbService.walletToOtherBanks).not.toHaveBeenCalled();
  });

  test("data purchases use the live 9PSB price, not the drafted one", async () => {
    PsbVasService.getDataPlans.mockResolvedValueOnce([{ productId: "P1", price: 1500 }]);
    const intent = await PI.draft({
      user, account, kind: "DATA", amount: 1000, payload: { phoneNumber: "08012345678", productId: "P1" }, summary: "1GB",
    });
    await PI.authorize({ intentId: intent.id, userId: user.id, pin: PIN });
    await PI.execute(intent.id);
    expect(PsbVasService.buyData).not.toHaveBeenCalled();
    expect(prisma.transaction.rows[0].status).toBe("FAILED");
  });
});

test("payments can be switched off", async () => {
  const config = (await import("../../config/env.js")).default;
  config.paymentsEnabled = false;
  await expect(draftTransfer()).rejects.toMatchObject({ code: "PAYMENTS_DISABLED" });
  config.paymentsEnabled = true;
});
