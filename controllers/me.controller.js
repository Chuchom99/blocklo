import Joi from "joi";
import prisma from "../config/prisma.js";
import PsbService from "../services/psb.service.js";
import PsbVasService from "../services/psb.vas.services.js";
import { BankService } from "../services/bank.service.js";
import { BeneficiaryService } from "../services/beneficiary.service.js";
import * as PaymentIntents from "../services/payment-intent.service.js";
import { buildAirtime, buildBill, buildData, buildTransfer, BILL_CATEGORIES } from "../services/payment-builder.service.js";
import { badRequest, notFound } from "../utils/errors.js";
import { publicIntent, publicTransaction } from "../utils/serialize.js";
import { renderReceipt } from "../utils/receipt.pdf.js";

// Everything here is scoped to req.user. No route accepts a userId or account
// number for the *source* of funds: it is always the logged-in user's wallet.

const validate = (schema, body) => {
  const { value, error } = schema.validate(body, { abortEarly: true, stripUnknown: true, convert: true });
  if (error) throw badRequest(error.details[0].message.replace(/"/g, ""), "VALIDATION");
  return value;
};

const ctxOf = (req) => {
  const account = req.user.accounts[0];
  if (!account) throw badRequest("Your wallet is still being set up.", "NO_ACCOUNT");
  return { user: req.user, account };
};

const amount = Joi.number().positive().precision(2).max(10_000_000);

const paymentSchema = Joi.object({
  kind: Joi.string().valid("TRANSFER", "AIRTIME", "DATA", "BILL").required(),
  amount: amount.when("kind", { is: Joi.valid("TRANSFER", "AIRTIME"), then: Joi.required() }),
  accountNumber: Joi.string().pattern(/^\d{10}$/).when("kind", { is: "TRANSFER", then: Joi.required() }),
  bankCode: Joi.string().max(10).when("kind", { is: "TRANSFER", then: Joi.required() }),
  phoneNumber: Joi.string().max(16).when("kind", { is: Joi.valid("AIRTIME", "DATA"), then: Joi.required() }),
  productId: Joi.string().max(64).when("kind", { is: "DATA", then: Joi.required() }),
  billType: Joi.string().valid(...Object.keys(BILL_CATEGORIES)).when("kind", { is: "BILL", then: Joi.required() }),
  billerId: Joi.string().max(64).when("kind", { is: "BILL", then: Joi.required() }),
  customerId: Joi.string().pattern(/^\d{6,20}$/).when("kind", { is: "BILL", then: Joi.required() }),
  itemId: Joi.string().max(64),
});

class MeController {
  static async balance(req, res) {
    const { account } = ctxOf(req);
    const balance = await PsbService.getBalance(account.accountNumber);
    if (balance === null) throw badRequest("Balance is temporarily unavailable.", "BALANCE_UNAVAILABLE");
    res.json({ success: true, balance, currency: "NGN" });
  }

  static async transactions(req, res) {
    const { account } = ctxOf(req);
    const { page, limit } = validate(
      Joi.object({ page: Joi.number().integer().min(1).default(1), limit: Joi.number().integer().min(1).max(50).default(20) }),
      req.query,
    );
    const [rows, total] = await Promise.all([
      prisma.transaction.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.transaction.count({ where: { accountId: account.id } }),
    ]);
    res.json({ success: true, page, total, transactions: rows.map(publicTransaction) });
  }

  static async receipt(req, res) {
    const { account } = ctxOf(req);
    const tx = await prisma.transaction.findFirst({ where: { id: req.params.id, accountId: account.id } });
    if (!tx) throw notFound();
    const pdf = await renderReceipt(tx, { customerName: `${req.user.firstName} ${req.user.lastName}`, sourceAccount: account.accountNumber });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="receipt_${tx.reference}.pdf"`, "Cache-Control": "no-store" });
    res.send(pdf);
  }

  static async banks(req, res) {
    res.json({ success: true, banks: await BankService.getBanks() });
  }

  static async dataPlans(req, res) {
    const { phone } = validate(Joi.object({ phone: Joi.string().max(16).required() }), req.query);
    res.json({ success: true, plans: await PsbVasService.getDataPlans(phone) });
  }

  static async beneficiaries(req, res) {
    const rows = await prisma.beneficiary.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" } });
    res.json({
      success: true,
      beneficiaries: rows.map((b) => ({ alias: b.alias, accountName: b.accountName, accountNumber: b.accountNo, bankCode: b.bankCode, bankName: b.bankName })),
    });
  }

  static async saveBeneficiary(req, res) {
    const { alias, accountNumber, bank } = validate(
      Joi.object({
        alias: Joi.string().pattern(/^[a-zA-Z][a-zA-Z0-9]{0,29}$/).required(),
        accountNumber: Joi.string().pattern(/^\d{10}$/).required(),
        bank: Joi.string().max(60).required(),
      }),
      req.body,
    );
    const message = await BeneficiaryService.save(req.user.id, alias, accountNumber, bank);
    res.json({ success: true, message });
  }

  static async deleteBeneficiary(req, res) {
    const removed = await BeneficiaryService.remove(req.user.id, req.params.alias);
    if (!removed) throw notFound();
    res.json({ success: true });
  }

  // Step 1: create a DRAFT payment from server-resolved details. Nothing moves yet.
  static async createPayment(req, res) {
    const ctx = ctxOf(req);
    const body = validate(paymentSchema, req.body);

    const built = await {
      TRANSFER: () => buildTransfer(ctx, { amount: body.amount, accountNumber: body.accountNumber, bank: { code: body.bankCode } }),
      AIRTIME: () => buildAirtime(ctx, { phoneNumber: body.phoneNumber, amount: body.amount }),
      DATA: () => buildData(ctx, { phoneNumber: body.phoneNumber, productId: body.productId }),
      BILL: () => buildBill(ctx, { type: body.billType, billerId: body.billerId, customerId: body.customerId, amount: body.amount, itemId: body.itemId }),
    }[body.kind]();

    const intent = await PaymentIntents.draft({ ...ctx, ...built, channel: "api" });
    res.status(201).json({ success: true, payment: publicIntent(intent) });
  }

  // Step 2: authorize with the PIN. Execution happens asynchronously; poll GET /payments/:id.
  static async authorizePayment(req, res) {
    const { pin } = validate(Joi.object({ pin: Joi.string().pattern(/^\d{4}$/).required() }), req.body);
    const result = await PaymentIntents.authorize({ intentId: req.params.id, userId: req.user.id, pin });

    if (result.ok) return res.status(202).json({ success: true, status: "PROCESSING", paymentId: req.params.id });

    const errors = {
      WRONG: [401, `Incorrect PIN. ${result.remaining} attempt(s) left.`],
      LOCKED: [423, "Too many incorrect PIN attempts. Try again later."],
      NO_PIN: [400, "No transaction PIN is set."],
      EXPIRED: [410, "This payment request has expired."],
      ALREADY_USED: [409, "This payment request was already used or cancelled."],
      NOT_FOUND: [404, "Not found"],
    };
    const [status, message] = errors[result.reason] || [400, "Payment could not be authorized."];
    res.status(status).json({ success: false, code: result.reason, message, ...(result.lockedUntil && { lockedUntil: result.lockedUntil }) });
  }

  static async getPayment(req, res) {
    const intent = await prisma.paymentIntent.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { transaction: true },
    });
    if (!intent) throw notFound();
    res.json({ success: true, payment: publicIntent(intent, intent.transaction) });
  }

  static async cancelPayment(req, res) {
    if (!(await PaymentIntents.cancel(req.params.id, req.user.id))) throw notFound("No open payment request with that id.");
    res.json({ success: true });
  }
}

export default MeController;
