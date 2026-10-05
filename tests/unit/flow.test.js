import { jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import { mockInfra } from "../helpers/fakes.js";

const { prisma, redis, queues } = mockInfra();
jest.unstable_mockModule("../../services/whatsapp.services.js", () => ({
  default: { sendFlow: jest.fn(), sendReply: jest.fn(), sendMessage: jest.fn(async () => true) },
}));
jest.unstable_mockModule("../../services/psb.service.js", () => ({
  default: { getBalance: jest.fn(async () => 1_000_000) },
  OUTCOME: { SUCCESS: "SUCCESS", FAILED: "FAILED", UNKNOWN: "UNKNOWN" },
  classifyResponse: jest.fn(),
  classifyStatusQuery: jest.fn(),
}));

const tokens = await import("../../services/flow-token.service.js");
const { handleFlowRequest, FlowTokenError } = await import("../../services/flow.service.js");
const PI = await import("../../services/payment-intent.service.js");

const VICTIM = "2348012345678";
const ATTACKER = "2348099999999";
let user;
let intent;

beforeEach(async () => {
  for (const t of Object.values(prisma)) if (t.rows) t.rows.length = 0;
  redis.store.clear();
  user = await prisma.user.create({
    data: { firstName: "Ada", lastName: "Obi", whatsappId: VICTIM, transactionPin: await bcrypt.hash("2580", 4) },
  });
  const account = await prisma.account.create({ data: { userId: user.id, accountNumber: "1100000001" } });
  intent = await PI.draft({ user, account, kind: "TRANSFER", amount: 5000, payload: {}, summary: "Send ₦5,000 to JOHN" });
});

describe("flow tokens", () => {
  test("a payment token is bound to the intent owner", () => {
    const token = tokens.parseToken(tokens.issuePaymentToken(intent.id, VICTIM));
    expect(tokens.verifyPaymentToken(token, VICTIM)).toBe(true);
    expect(tokens.verifyPaymentToken(token, ATTACKER)).toBe(false);
  });

  test("an attacker can't mint a token for someone else's intent", async () => {
    const forged = tokens.issuePaymentToken(intent.id, ATTACKER);
    await expect(handleFlowRequest({ action: "INIT", flow_token: forged })).rejects.toBeInstanceOf(FlowTokenError);
  });

  test("tampered and malformed tokens are rejected", async () => {
    const good = tokens.issuePaymentToken(intent.id, VICTIM);
    await expect(handleFlowRequest({ action: "INIT", flow_token: `${good}x` })).rejects.toBeInstanceOf(FlowTokenError);
    await expect(handleFlowRequest({ action: "INIT", flow_token: "garbage" })).rejects.toBeInstanceOf(FlowTokenError);
  });

  test("registration tokens are single-use and bound to the number", async () => {
    const raw = await tokens.issueRegistrationToken(VICTIM);
    const t = tokens.parseToken(raw);
    expect(await tokens.resolveRegistrationToken(t)).toBe(VICTIM);
    await tokens.consumeRegistrationToken(t);
    expect(await tokens.resolveRegistrationToken(t)).toBeNull();
  });
});

describe("payment Flow", () => {
  const token = () => tokens.issuePaymentToken(intent.id, VICTIM);

  test("ping", async () => {
    expect(await handleFlowRequest({ action: "ping" })).toEqual({ data: { status: "active" } });
  });

  test("INIT renders the server-side summary", async () => {
    const res = await handleFlowRequest({ action: "INIT", flow_token: token() });
    expect(res.screen).toBe("CONFIRM");
    expect(res.data.summary).toBe("Send ₦5,000 to JOHN");
  });

  test("wrong PIN stays on the confirm screen with an error", async () => {
    const res = await handleFlowRequest({ action: "data_exchange", flow_token: token(), data: { pin: "1111" } });
    expect(res.screen).toBe("CONFIRM");
    expect(res.data.has_error).toBe(true);
    expect(queues.paymentsQueue.add).not.toHaveBeenCalled();
  });

  test("correct PIN closes the flow and queues execution once", async () => {
    const res = await handleFlowRequest({ action: "data_exchange", flow_token: token(), data: { pin: "2580" } });
    expect(res.screen).toBe("SUCCESS");
    const again = await handleFlowRequest({ action: "data_exchange", flow_token: token(), data: { pin: "2580" } });
    expect(again.screen).toBe("INFO");
    expect(queues.paymentsQueue.add).toHaveBeenCalledTimes(1);
  });

  test("cancel", async () => {
    const res = await handleFlowRequest({ action: "data_exchange", flow_token: token(), data: { cancel: true } });
    expect(res.screen).toBe("SUCCESS");
    expect(prisma.paymentIntent.rows[0].status).toBe("CANCELLED");
  });
});
