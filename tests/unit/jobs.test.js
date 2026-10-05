import { jest } from "@jest/globals";
import { mockInfra } from "../helpers/fakes.js";

const { prisma } = mockInfra();

const PsbService = { requeryTransaction: jest.fn(), notificationRequery: jest.fn() };
jest.unstable_mockModule("../../services/psb.service.js", () => ({
  default: PsbService,
  OUTCOME: { SUCCESS: "SUCCESS", FAILED: "FAILED", UNKNOWN: "UNKNOWN" },
  classifyResponse: jest.fn(),
  classifyStatusQuery: jest.fn(),
}));
const PsbVasService = { getTopupStatus: jest.fn(), getBillStatus: jest.fn() };
jest.unstable_mockModule("../../services/psb.vas.services.js", () => ({ default: PsbVasService }));
const WhatsAppService = { sendReply: jest.fn(), sendMessage: jest.fn() };
jest.unstable_mockModule("../../services/whatsapp.services.js", () => ({ default: WhatsAppService }));

const { reconcileTransaction, runReconciliation } = await import("../../jobs/reconcile.job.js");
const { processPsbWebhook } = await import("../../jobs/psb-webhook.job.js");

let user;
let account;

beforeEach(async () => {
  for (const t of Object.values(prisma)) if (t.rows) t.rows.length = 0;
  jest.clearAllMocks();
  user = await prisma.user.create({ data: { firstName: "Ada", lastName: "Obi", whatsappId: "2348012345678" } });
  account = await prisma.account.create({ data: { userId: user.id, accountNumber: "1100000001" } });
});

const openTx = async (over = {}) => {
  const intent = await prisma.paymentIntent.create({
    data: { userId: user.id, accountId: account.id, kind: "TRANSFER", amount: 5000, summary: "Send", status: "DONE", expiresAt: new Date() },
  });
  return prisma.transaction.create({
    data: {
      userId: user.id, accountId: account.id, intentId: intent.id, kind: "TRANSFER", type: "DEBIT", amount: 5000,
      reference: "ref-1", status: "UNKNOWN", createdAt: new Date(Date.now() - 10 * 60_000), ...over,
    },
  });
};

describe("reconciliation", () => {
  test("settles an UNKNOWN transfer from the requery and notifies once", async () => {
    await openTx();
    PsbService.requeryTransaction.mockResolvedValue({ outcome: "FAILED", raw: {} });
    await runReconciliation();
    await runReconciliation();
    expect(prisma.transaction.rows[0].status).toBe("FAILED");
    expect(prisma.paymentIntent.rows[0].status).toBe("FAILED");
    expect(WhatsAppService.sendReply).toHaveBeenCalledTimes(1);
  });

  test("an inconclusive requery is retried, then flagged for review", async () => {
    const tx = await openTx({ requeryCount: 11 });
    PsbService.requeryTransaction.mockResolvedValue({ outcome: "UNKNOWN", raw: null });
    await reconcileTransaction({ ...tx, account, user });
    expect(prisma.transaction.rows[0]).toMatchObject({ status: "UNKNOWN", needsReview: true, requeryCount: 12 });
  });

  test("a settled transaction is never changed again", async () => {
    const tx = await openTx({ status: "SUCCESS" });
    PsbService.requeryTransaction.mockResolvedValue({ outcome: "FAILED", raw: {} });
    await reconcileTransaction({ ...tx, account, user });
    expect(prisma.transaction.rows[0].status).toBe("SUCCESS");
  });
});

describe("9PSB webhook events", () => {
  test("a status event triggers a requery instead of being trusted", async () => {
    await openTx();
    PsbService.requeryTransaction.mockResolvedValue({ outcome: "SUCCESS", raw: {} });
    await processPsbWebhook({ transactionReference: "ref-1", status: "FAILED" });
    expect(PsbService.requeryTransaction).toHaveBeenCalled();
    expect(prisma.transaction.rows[0].status).toBe("SUCCESS");
  });

  test("an inflow is recorded only after 9PSB confirms it, and only once", async () => {
    PsbService.notificationRequery.mockResolvedValue({ data: { amount: "2500", originatorName: "BOLA" } });
    const event = { sessionID: "S1", accountNumber: "1100000001", amount: "999999" };
    await processPsbWebhook(event);
    await processPsbWebhook(event);
    const credits = prisma.transaction.rows.filter((t) => t.type === "CREDIT");
    expect(credits).toHaveLength(1);
    expect(credits[0].amount).toBe(2500); // the confirmed amount, not the webhook's claim
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
  });

  test("an unconfirmed inflow is not recorded", async () => {
    PsbService.notificationRequery.mockRejectedValue(new Error("Notification requery failed"));
    await expect(processPsbWebhook({ sessionID: "S2", accountNumber: "1100000001", amount: "1000" })).rejects.toThrow();
    expect(prisma.transaction.rows).toHaveLength(0);
  });
});
