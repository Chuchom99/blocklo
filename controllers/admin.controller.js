import Joi from "joi";
import prisma from "../config/prisma.js";
import PsbService from "../services/psb.service.js";
import { reconcileTransaction } from "../jobs/reconcile.job.js";
import { badRequest, notFound } from "../utils/errors.js";
import { publicTransaction } from "../utils/serialize.js";

// Ops endpoints (behind requireAdmin). These used to be public under /api/psb.

const validate = (schema, body) => {
  const { value, error } = schema.validate(body, { abortEarly: true, stripUnknown: true });
  if (error) throw badRequest(error.details[0].message.replace(/"/g, ""), "VALIDATION");
  return value;
};

const accountNo = Joi.string().pattern(/^\d{10}$/).required();

class AdminController {
  static async walletEnquiry(req, res) {
    const { accountNo: acct } = validate(Joi.object({ accountNo }), req.body);
    res.json({ success: true, data: await PsbService.walletEnquiry(acct) });
  }

  static async walletStatus(req, res) {
    const { accountNo: acct } = validate(Joi.object({ accountNo }), req.body);
    res.json({ success: true, data: await PsbService.getWalletStatus(acct) });
  }

  static async changeWalletStatus(req, res) {
    const { accountNumber, accountStatus } = validate(
      Joi.object({ accountNumber: accountNo, accountStatus: Joi.string().valid("ACTIVE", "SUSPENDED").required() }),
      req.body,
    );
    res.json({ success: true, data: await PsbService.changeWalletStatus(accountNumber, accountStatus) });
  }

  static async walletByBvn(req, res) {
    const { bvn } = validate(Joi.object({ bvn: Joi.string().pattern(/^\d{11}$/).required() }), req.body);
    res.json({ success: true, data: await PsbService.getWalletByBVN(bvn) });
  }

  static async walletHistory(req, res) {
    const { accountNo: acct, fromDate, toDate } = validate(
      Joi.object({
        accountNo,
        fromDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        toDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      }),
      req.body,
    );
    res.json({ success: true, data: await PsbService.getTransactionHistory(acct, fromDate, toDate) });
  }

  static async notificationRequery(req, res) {
    const { sessionID, accountNumber } = validate(
      Joi.object({ sessionID: Joi.string().max(100).required(), accountNumber: accountNo }),
      req.body,
    );
    res.json({ success: true, data: await PsbService.notificationRequery(sessionID, accountNumber) });
  }

  // Wallet <-> float movements. Ops-only; requires an explicit reason for the audit log.
  static async floatTransfer(req, res) {
    const body = validate(
      Joi.object({
        accountNo,
        amount: Joi.number().positive().precision(2).required(),
        direction: Joi.string().valid("debit", "credit").required(),
        reason: Joi.string().min(5).max(100).required(),
      }),
      req.body,
    );
    const result = await PsbService.singleWalletTransfer({
      accountNo: body.accountNo,
      totalAmount: body.amount,
      narration: body.reason,
      merchant: { isFee: false },
      type: body.direction,
    });
    res.json({ success: true, outcome: result.outcome, data: result.raw });
  }

  static async reviewQueue(req, res) {
    const rows = await prisma.transaction.findMany({
      where: { needsReview: true, status: { in: ["PENDING", "UNKNOWN"] } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    res.json({ success: true, transactions: rows.map(publicTransaction) });
  }

  static async requery(req, res) {
    const tx = await prisma.transaction.findUnique({ where: { reference: req.params.reference }, include: { account: true, user: true } });
    if (!tx) throw notFound();
    const outcome = await reconcileTransaction(tx, { manual: true });
    res.json({ success: true, outcome });
  }
}

export default AdminController;
