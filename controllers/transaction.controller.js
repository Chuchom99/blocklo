// import TransactionService from '../services/transaction.service.js';

// class TransactionController {
//   /**
//    * Transfer funds between wallets
//    */
//   static async transfer(req, res) {
//     try {
//       const { fromUserId, toUserId, amount, pin } = req.body;

//       const transaction = await TransactionService.transfer({
//         fromUserId,
//         toUserId,
//         amount,
//         pin,
//       });

//       return res.status(201).json({ success: true, transaction });
//     } catch (error) {
//       console.error("Error in transfer:", error);
//       return res.status(400).json({ success: false, message: error.message });
//     }
//   }

//   /**
//    * Get transactions for a user
//    */
//   static async getUserTransactions(req, res) {
//     try {
//       const { userId } = req.params;
//       const transactions = await TransactionService.getUserTransactions(userId);

//       return res.status(200).json({ success: true, transactions });
//     } catch (error) {
//       console.error("Error fetching transactions:", error);
//       return res.status(500).json({ success: false, message: "Failed to fetch transactions" });
//     }
//   }

//   /**
//    * Get transaction details
//    */
//   static async getTransactionById(req, res) {
//     try {
//       const { id } = req.params;
//       const transaction = await TransactionService.getTransactionById(id);

//       if (!transaction) {
//         return res.status(404).json({ success: false, message: "Transaction not found" });
//       }

//       return res.status(200).json({ success: true, transaction });
//     } catch (error) {
//       console.error("Error fetching transaction:", error);
//       return res.status(500).json({ success: false, message: "Failed to fetch transaction" });
//     }
//   }
// }

// export default TransactionController;


import UserService from '../services/user.service.js';
import PsbService from '../services/psb.service.js';
import logger from '../config/logger.js';
import Joi from 'joi';
import prisma from '../config/prisma.js';

class TransactionController {
  // Submit KYC
  static async submitKyc(req, res) {
    const schema = Joi.object({
      userId: Joi.string().required().messages({
        'any.required': 'User ID is required',
      }),
      bvn: Joi.string().pattern(/^\d{11}$/).required().messages({
        'string.pattern.base': 'BVN must be 11 digits',
        'any.required': 'BVN is required',
      }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error during KYC submission: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { userId, bvn } = req.body;
      const result = await UserService.submitKyc(userId, bvn);
      logger.info(`KYC submitted for user ${userId}: BVN ${bvn}`);
      res.status(200).json({ success: true, message: 'KYC submitted successfully', result });
    } catch (err) {
      logger.error(`KYC Submission Error: ${err.message}`);
      if (err.message.includes('User not found') || err.message.includes('BVN already exists')) {
        return res.status(400).json({ success: false, message: err.message });
      }
      res.status(500).json({ success: false, message: 'Failed to submit KYC' });
    }
  }

  // Transfer
  static async transfer(req, res) {
    const schema = Joi.object({
      userId: Joi.string().required().messages({
        'any.required': 'User ID is required',
      }),
      pin: Joi.string().required().messages({
        'any.required': 'PIN is required',
      }),
      accountId: Joi.string().required().messages({
        'any.required': 'Account ID is required',
      }),
      amount: Joi.number().positive().required().messages({
        'number.positive': 'Amount must be positive',
        'any.required': 'Amount is required',
      }),
      recipientAccountNumber: Joi.string().required().messages({
        'any.required': 'Recipient account number is required',
      }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error during transfer: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { userId, pin, accountId, amount, recipientAccountNumber } = req.body;
      const validPin = await UserService.verifyPin(userId, pin);
      if (!validPin) {
        return res.status(401).json({ success: false, message: 'Invalid PIN' });
      }

      const account = await prisma.account.findUnique({ where: { id: accountId } });
      if (!account || account.userId !== userId) {
        return res.status(400).json({ success: false, message: 'Invalid account' });
      }
      if (account.balance < amount) {
        return res.status(400).json({ success: false, message: 'Insufficient balance' });
      }

      // Process transfer via 9PSB
      const psbResult = await PsbService.processTransfer(userId, accountId, amount, recipientAccountNumber);

      const transaction = await prisma.transaction.create({
        data: {
          userId,
          accountId,
          amount,
          type: 'DEBIT',
          reference: psbResult.data.reference,
        },
      });

      await prisma.account.update({
        where: { id: accountId },
        data: { balance: account.balance - amount },
      });

      logger.info(`Transfer initiated for user ${userId}: ${amount} to ${recipientAccountNumber}`);
      res.status(200).json({ success: true, message: 'Transfer initiated', transaction });
    } catch (err) {
      logger.error(`Transfer Error: ${err.message}`);
      res.status(500).json({ success: false, message: 'Failed to process transfer' });
    }
  }

  // Payment
  static async payment(req, res) {
    const schema = Joi.object({
      userId: Joi.string().required().messages({
        'any.required': 'User ID is required',
      }),
      pin: Joi.string().required().messages({
        'any.required': 'PIN is required',
      }),
      accountId: Joi.string().required().messages({
        'any.required': 'Account ID is required',
      }),
      amount: Joi.number().positive().required().messages({
        'number.positive': 'Amount must be positive',
        'any.required': 'Amount is required',
      }),
      payee: Joi.string().required().messages({
        'any.required': 'Payee is required',
      }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error during payment: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { userId, pin, accountId, amount, payee } = req.body;
      const validPin = await UserService.verifyPin(userId, pin);
      if (!validPin) {
        return res.status(401).json({ success: false, message: 'Invalid PIN' });
      }

      const account = await prisma.account.findUnique({ where: { id: accountId } });
      if (!account || account.userId !== userId) {
        return res.status(400).json({ success: false, message: 'Invalid account' });
      }
      if (account.balance < amount) {
        return res.status(400).json({ success: false, message: 'Insufficient balance' });
      }

      // Process payment via 9PSB
      const psbResult = await PsbService.processPayment(userId, accountId, amount, payee);

      const transaction = await prisma.transaction.create({
        data: {
          userId,
          accountId,
          amount,
          type: 'DEBIT',
          reference: psbResult.data.reference,
        },
      });

      await prisma.account.update({
        where: { id: accountId },
        data: { balance: account.balance - amount },
      });

      logger.info(`Payment initiated for user ${userId}: ${amount} to ${payee}`);
      res.status(200).json({ success: true, message: 'Payment initiated', transaction });
    } catch (err) {
      logger.error(`Payment Error: ${err.message}`);
      res.status(500).json({ success: false, message: 'Failed to process payment' });
    }
  }

  // Deposit
  static async deposit(req, res) {
    const schema = Joi.object({
      userId: Joi.string().required().messages({
        'any.required': 'User ID is required',
      }),
      pin: Joi.string().required().messages({
        'any.required': 'PIN is required',
      }),
      accountId: Joi.string().required().messages({
        'any.required': 'Account ID is required',
      }),
      amount: Joi.number().positive().required().messages({
        'number.positive': 'Amount must be positive',
        'any.required': 'Amount is required',
      }),
      source: Joi.string().required().messages({
        'any.required': 'Source is required',
      }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error during deposit: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { userId, pin, accountId, amount, source } = req.body;
      const validPin = await UserService.verifyPin(userId, pin);
      if (!validPin) {
        return res.status(401).json({ success: false, message: 'Invalid PIN' });
      }

      const account = await prisma.account.findUnique({ where: { id: accountId } });
      if (!account || account.userId !== userId) {
        return res.status(400).json({ success: false, message: 'Invalid account' });
      }

      // Process deposit via 9PSB
      const psbResult = await PsbService.processDeposit(userId, accountId, amount, source);

      const transaction = await prisma.transaction.create({
        data: {
          userId,
          accountId,
          amount,
          type: 'CREDIT',
          reference: psbResult.data.reference,
        },
      });

      await prisma.account.update({
        where: { id: accountId },
        data: { balance: account.balance + amount },
      });

      logger.info(`Deposit initiated for user ${userId}: ${amount} from ${source}`);
      res.status(200).json({ success: true, message: 'Deposit initiated', transaction });
    } catch (err) {
      logger.error(`Deposit Error: ${err.message}`);
      res.status(500).json({ success: false, message: 'Failed to process deposit' });
    }
  }
}

export default TransactionController;