import express from 'express';
import transactionController from '../controllers/transaction.controller.js';
const router = express.Router();

// Transactions
router.get('/:userId', transactionController.getUserTransactions);
router.get('/:userId/:transactionId', transactionController.getTransactionById);

export default router;
