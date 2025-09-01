import express from 'express';
import WalletController from '../controllers/wallet.controller.js';

const router = express.Router();

// Wallet endpoints
router.post('/create', WalletController.createWallet);
router.get('/:userId', WalletController.getWallet);
router.post('/credit', WalletController.creditWallet);
router.post('/debit', WalletController.debitWallet);

export default router;
