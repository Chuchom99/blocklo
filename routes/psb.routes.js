import express from 'express';
import PsbController from '../controllers/psb.controller.js';
import whatsappAuthMiddleware from '../middlwares/whatsappAuthmiddlware.js';        
const router = express.Router();

// 9PSB services
router.post("/wallet/enquiry", PsbController.walletEnquiry);
router.post("/wallet/debit", PsbController.debitWallet);
router.post("/wallet/credit", PsbController.creditWallet);
router.post("/wallet/balance", PsbController.balanceEnquiry);

router.post("/wallet/transactions", PsbController.transactionHistory);
router.post("/wallet/requery", PsbController.transactionStatus);
router.post("/wallet/to-other-banks", PsbController.walletToOtherBanks);
router.post("/other-banks/enquiry", PsbController.otherBankEnquiry);
router.post("/wallet/status", PsbController.walletStatus);
router.post("/wallet/change-status", PsbController.changeWalletStatus);
router.get("/banks", PsbController.getBanks);
router.post("/notification/requery", PsbController.notificationRequery);
router.post("/wallet/by-bvn", PsbController.getWalletByBVN);

// router.post('/bvn/verify',  whatsappAuthMiddleware, PsbController.verifyBVN);
// router.post('/balance', whatsappAuthMiddleware, PsbController.checkBalance);
// router.post('/transfer', whatsappAuthMiddleware, PsbController.transfer);
// router.post('/account/validate', whatsappAuthMiddleware, PsbController.validateAccount);

export default router;