import PsbService from "../services/psb.service.js";
import logger from "../config/logger.js";
import Joi from "joi";
import prisma from "../config/prisma.js";

class PsbController {
  static async walletEnquiry(req, res) {
    const schema = Joi.object({
      accountNo: Joi.string().required().messages({
        "any.required": "accountNo is required",
      }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(
        `Validation error during wallet enquiry: ${validationError.details[0].message}`
      );
      return res
        .status(400)
        .json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { accountNo } = req.body;
      const data = await PsbService.walletEnquiry(accountNo);
      res.json({ success: true, message: "Wallet enquiry successful", data });
    } catch (err) {
      logger.error(`Wallet Enquiry Error: ${err.message}`);
      res
        .status(500)
        .json({ success: false, message: "Wallet enquiry failed" });
    }
  }

    static async balanceEnquiry(req, res) {
    const schema = Joi.object({
      accountNo: Joi.string().required().messages({
        "any.required": "accountNo is required",
      }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(
        `Validation error during wallet enquiry: ${validationError.details[0].message}`
      );
      return res
        .status(400)
        .json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { accountNo } = req.body;
      const data = await PsbService.getBalance(accountNo);
      res.json({ success: true, message: "Wallet enquiry successful", data });
    } catch (err) {
      logger.error(`Wallet Enquiry Error: ${err.message}`);
      res
        .status(500)
        .json({ success: false, message: "Wallet enquiry failed" });
    }
  }

  static async debitWallet(req, res) {
    const schema = Joi.object({
      accountNo: Joi.string().required(),
      totalAmount: Joi.number().required(),
      narration: Joi.string().max(100).required(),
      merchant: Joi.object({
        isFee: Joi.boolean().required(),
        merchantFeeAmount: Joi.string().allow("", null).optional(),
        merchantFeeAccount: Joi.string().allow("", null).optional(),
      }).required(),
    });

    // 🧹 Auto-fix empty merchant fields if isFee = false
    if (req.body.merchant && !req.body.merchant.isFee) {
      req.body.merchant.merchantFeeAmount = "0";
      req.body.merchant.merchantFeeAccount = "0000000000";
    }

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(
        `Validation error during wallet debit: ${validationError.details[0].message}`
      );
      return res
        .status(400)
        .json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { accountNo, totalAmount, narration, merchant } = req.body;
      const data = await PsbService.singleWalletTransfer(
        accountNo,
        totalAmount,
        narration,
        merchant,
        "debit"
      );
      res.json({ success: true, message: "Wallet debit successful", data });
    } catch (err) {
      logger.error(`Wallet Debit Error: ${err.message}`);
      res.status(500).json({ success: false, message: "Wallet debit failed" });
    }
  }

  // 3️⃣ Wallet Credit
  static async creditWallet(req, res) {
    const schema = Joi.object({
      accountNo: Joi.string().required(),
      totalAmount: Joi.number().required(),
      narration: Joi.string().max(100).required(),
      merchant: Joi.object({
        isFee: Joi.boolean().required(),
        merchantFeeAmount: Joi.string().allow("", null).optional(),
        merchantFeeAccount: Joi.string().allow("", null).optional(),
      }).required(),
    });

    if (req.body.merchant && !req.body.merchant.isFee) {
      req.body.merchant.merchantFeeAmount = "0";
      req.body.merchant.merchantFeeAccount = "0000000000";
    }

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(
        `Validation error during wallet credit: ${validationError.details[0].message}`
      );
      return res
        .status(400)
        .json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { accountNo, totalAmount, narration, merchant } = req.body;
      const data = await PsbService.singleWalletTransfer(
        accountNo,
        totalAmount,
        narration,
        merchant,
        "credit"
      );
      res.json({ success: true, message: "Wallet credit successful", data });
    } catch (err) {
      logger.error(`Wallet Credit Error: ${err.message}`);
      res.status(500).json({ success: false, message: "Wallet credit failed" });
    }
  }


  static async transactionHistory(req, res) {
    const schema = Joi.object({
      accountNo: Joi.string().required(),
      fromDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      toDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      numberOfItems: Joi.string().default("50"),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { accountNo, fromDate, toDate, numberOfItems } = req.body;
      const data = await PsbService.getTransactionHistory(accountNo, fromDate, toDate, numberOfItems);
      res.json({ success: true, message: "Transaction history fetched", data });
    } catch (err) {
      logger.error(`Transaction History Error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message || "Failed to fetch history" });
    }
  }

  static async transactionStatus(req, res) {
    const schema = Joi.object({
      transactionId: Joi.string().required(),
      amount: Joi.number().required(),
      transactionType: Joi.string().required(),
      transactionDate: Joi.string().required(),
      accountNo: Joi.string().required(),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { transactionId, amount, transactionType, transactionDate, accountNo } = req.body;
      const data = await PsbService.requeryTransaction(transactionId, amount, transactionType, transactionDate, accountNo);
      res.json({ success: true, message: "Transaction status retrieved", data });
    } catch (err) {
      logger.error(`Transaction Status Error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message || "Transaction status failed" });
    }
  }

  static async walletToOtherBanks(req, res) {
    const schema = Joi.object({
      accountNo: Joi.string().required(),
      amount: Joi.number().positive().required(),
      narration: Joi.string().max(100).required(),
      destinationAccount: Joi.string().length(10).required(),
      destinationBankCode: Joi.string().required(),
      destinationName: Joi.string().optional(),
      senderName: Joi.string().optional(),
      name: Joi.string().optional(),
      merchant: Joi.object({
        isFee: Joi.boolean().required(),
        merchantFeeAmount: Joi.string().allow("", null).optional(),
        merchantFeeAccount: Joi.string().allow("", null).optional(),
      }).required(),
    });

    if (req.body.merchant && !req.body.merchant.isFee) {
      req.body.merchant.merchantFeeAmount = "0";
      req.body.merchant.merchantFeeAccount = "0000000000";
    }

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const data = await PsbService.walletToOtherBanks(req.body);
      res.json({ success: true, message: "Transfer to other bank initiated", data });
    } catch (err) {
      logger.error(`Wallet To Other Banks Error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message || "Transfer failed" });
    }
  }

  static async otherBankEnquiry(req, res) {
    const schema = Joi.object({
      account: Joi.string().length(10).required(),
      bank: Joi.string().required(),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { account, bank } = req.body;
      const data = await PsbService.otherBankEnquiry(account, bank);
      res.json({ success: true, message: "Account name enquiry successful", data });
    } catch (err) {
      logger.error(`Other Bank Enquiry Error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message || "Name enquiry failed" });
    }
  }

  static async walletStatus(req, res) {
    const schema = Joi.object({
      accountNo: Joi.string().required(),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { accountNo } = req.body;
      const data = await PsbService.getWalletStatus(accountNo);
      res.json({ success: true, message: "Wallet status retrieved", data });
    } catch (err) {
      logger.error(`Wallet Status Error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message || "Failed to get status" });
    }
  }

  static async changeWalletStatus(req, res) {
    const schema = Joi.object({
      accountNumber: Joi.string().required(),
      accountStatus: Joi.string().valid("ACTIVE", "SUSPENDED").required(),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { accountNumber, accountStatus } = req.body;
      const data = await PsbService.changeWalletStatus(accountNumber, accountStatus);
      res.json({ success: true, message: `Wallet ${accountStatus.toLowerCase()} successfully`, data });
    } catch (err) {
      logger.error(`Change Wallet Status Error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message || "Failed to change status" });
    }
  }

  static async getBanks(req, res) {
    try {
      const data = await PsbService.getBanks();
      res.json({ success: true, message: "Banks fetched", data });
    } catch (err) {
      logger.error(`Get Banks Error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message || "Failed to fetch banks" });
    }
  }

  static async notificationRequery(req, res) {
    const schema = Joi.object({
      sessionID: Joi.string().required(),
      accountNumber: Joi.string().required(),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { sessionID, accountNumber } = req.body;
      const data = await PsbService.notificationRequery(sessionID, accountNumber);
      res.json({ success: true, message: "Notification requery successful", data });
    } catch (err) {
      logger.error(`Notification Requery Error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message || "Requery failed" });
    }
  }

  static async getWalletByBVN(req, res) {
    const schema = Joi.object({
      bvn: Joi.string().length(11).required(),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { bvn } = req.body;
      const data = await PsbService.getWalletByBVN(bvn);
      res.json({ success: true, message: "Wallet fetched by BVN", data });
    } catch (err) {
      logger.error(`Get Wallet By BVN Error: ${err.message}`);
      res.status(500).json({ success: false, message: err.message || "Failed to fetch wallet" });
    }
  }

  

}

export default PsbController;
