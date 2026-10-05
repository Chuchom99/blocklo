import { jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import { mockInfra } from "../helpers/fakes.js";

const { prisma, redis } = mockInfra();

const WhatsAppService = { sendFlow: jest.fn(), sendReply: jest.fn(), sendMessage: jest.fn(), sendInteractive: jest.fn() };
jest.unstable_mockModule("../../services/whatsapp.services.js", () => ({ default: WhatsAppService }));

const PsbService = {
  getBalance: jest.fn(async () => 500_000),
  otherBankEnquiry: jest.fn(async () => "JOHN DOE"),
  getBanks: jest.fn(async () => [{ bankName: "Guaranty Trust Bank", bankCode: "058" }, { bankName: "Access Bank", bankCode: "044" }]),
  walletToOtherBanks: jest.fn(),
};
jest.unstable_mockModule("../../services/psb.service.js", () => ({
  default: PsbService,
  OUTCOME: { SUCCESS: "SUCCESS", FAILED: "FAILED", UNKNOWN: "UNKNOWN" },
  classifyResponse: jest.fn(),
  classifyStatusQuery: jest.fn(),
}));

const PsbVasService = {
  detectNetwork: jest.fn(async () => ({ name: "MTN" })),
  getCategoryBillers: jest.fn(async () => ({ data: [{ id: "BP-IKEJA", name: "Ikeja Electric" }] })),
  validatePayment: jest.fn(async () => ({ data: { customerName: "METER OWNER" } })),
  getDataPlans: jest.fn(async () => []),
  buyAirtime: jest.fn(),
  payBill: jest.fn(),
};
jest.unstable_mockModule("../../services/psb.vas.services.js", () => ({ default: PsbVasService }));

// The LLM tries to send money directly via a tool call.
const invoke = jest.fn();
jest.unstable_mockModule("@langchain/deepseek", () => ({ ChatDeepSeek: jest.fn().mockImplementation(() => ({ invoke })) }));

const { langchainService } = await import("../../services/ai.services.js");
const { BankService } = await import("../../services/bank.service.js");

const FROM = "2348012345678";
const say = (body) => langchainService.route({ from: FROM, message: { type: "text", text: { body } }, profileName: "Ada" });
const tap = (id) => langchainService.route({ from: FROM, message: { type: "interactive", interactive: { type: "button_reply", button_reply: { id } } } });
const pick = (id) => langchainService.route({ from: FROM, message: { type: "interactive", interactive: { type: "list_reply", list_reply: { id } } } });

beforeEach(async () => {
  for (const t of Object.values(prisma)) if (t.rows) t.rows.length = 0;
  redis.store.clear();
  BankService.cache = null;
  jest.clearAllMocks();
  const user = await prisma.user.create({
    data: { firstName: "Ada", lastName: "Obi", phone: "08012345678", whatsappId: FROM, transactionPin: await bcrypt.hash("2580", 4) },
  });
  await prisma.account.create({ data: { userId: user.id, accountNumber: "1100000001", createdAt: new Date() } });
});

test("'send 5000 to <acct> <bank>' drafts a payment and sends the PIN Flow — it does not transfer", async () => {
  const reply = await say("send 5000 to 0123456789 gtbank");
  expect(reply).toEqual({ sent: true });
  expect(PsbService.walletToOtherBanks).not.toHaveBeenCalled();
  expect(prisma.paymentIntent.rows).toHaveLength(1);
  expect(prisma.paymentIntent.rows[0]).toMatchObject({ status: "DRAFT", kind: "TRANSFER", amount: 5000 });
  expect(prisma.paymentIntent.rows[0].summary).toContain("JOHN DOE");
  expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
});

test("asks for the bank instead of defaulting to one", async () => {
  expect(await say("send 5000 to 0123456789")).toMatch(/Which bank/);
  expect(await say("access")).toEqual({ sent: true });
  expect(prisma.paymentIntent.rows[0].payload.bankCode).toBe("044");
});

test("an unverifiable account is refused (no more 'Test Receiver')", async () => {
  PsbService.otherBankEnquiry.mockResolvedValueOnce(null);
  expect(await say("send 5000 to 0123456789 gtbank")).toMatch(/couldn't verify/i);
  expect(prisma.paymentIntent.rows).toHaveLength(0);
});

test("'pay 500 to …' no longer crashes on a missing bill flow", async () => {
  expect(await say("pay 500 to 0123456789 access")).toEqual({ sent: true });
});

test("a PIN typed in chat is refused and never stored or sent to the LLM", async () => {
  expect(await say("2580")).toMatch(/never send your PIN/i);
  expect(invoke).not.toHaveBeenCalled();
  expect([...redis.store.keys()].some((k) => k.startsWith("convo:"))).toBe(false);
});

test("unregistered numbers get the encrypted registration Flow, not a chat form", async () => {
  const reply = await langchainService.route({ from: "2348099999999", message: { text: { body: "hi" } }, profileName: "Bola" });
  expect(reply).toEqual({ sent: true });
  expect(WhatsAppService.sendFlow.mock.calls[0][1].flowId).toBe("registration-flow-id");
});

test("Flow completion messages are ignored by the router", async () => {
  expect(await langchainService.route({ from: FROM, message: { interactive: { type: "nfm_reply" } } })).toBeNull();
});

test("electricity: list taps and a bare meter number reach the flow", async () => {
  await say("electricity");
  expect(await pick("DISCO_BP-IKEJA")).toMatch(/meter number/i);
  expect(await say("12345678901")).toMatch(/How much/i);
  expect(await say("5000")).toEqual({ sent: true });
  expect(prisma.paymentIntent.rows[0]).toMatchObject({ kind: "BILL", amount: 5000 });
  expect(PsbVasService.payBill).not.toHaveBeenCalled();
});

test("beneficiary removal needs a button confirmation", async () => {
  const user = prisma.user.rows[0];
  await prisma.beneficiary.create({ data: { userId: user.id, alias: "mom", accountNo: "0123456789", bankCode: "058", bankName: "GTB", accountName: "MAMA" } });
  const ask = await say("delete mom");
  expect(ask.type).toBe("interactive");
  expect(prisma.beneficiary.rows).toHaveLength(1);
  await tap("BENDEL_YES");
  expect(prisma.beneficiary.rows).toHaveLength(0);
});

test("cancel clears the flow and open drafts", async () => {
  await say("send 5000 to 0123456789 gtbank");
  await say("cancel");
  expect(prisma.paymentIntent.rows[0].status).toBe("CANCELLED");
});

describe("LLM is draft-only", () => {
  test("a model tool call to transfer only creates a draft and the model is told it isn't done", async () => {
    invoke
      .mockResolvedValueOnce({
        content: "",
        tool_calls: [{ id: "c1", name: "start_transfer", args: { amount: 20000, destination_account: "0123456789", bank_name: "gtbank" } }],
      })
      .mockResolvedValueOnce({ content: "Please confirm in the form I sent." });

    const reply = await say("abeg help me send twenty thousand to 0123456789 for gtbank");
    expect(reply).toBe("Please confirm in the form I sent.");
    expect(PsbService.walletToOtherBanks).not.toHaveBeenCalled();
    expect(prisma.paymentIntent.rows[0].status).toBe("DRAFT");
    const toolResult = invoke.mock.calls[1][0].find((m) => m.role === "tool").content;
    expect(toolResult).toMatch(/NOT complete/);
  });

  test("there is no tool that executes a payment", async () => {
    const { allTools } = await import("../../tools/index.js");
    expect(allTools.map((t) => t.name)).not.toEqual(expect.arrayContaining(["transfer_money", "pay_bill", "buy_data", "buy_airtime"]));
  });
});
