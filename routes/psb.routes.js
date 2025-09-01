import express from 'express';
import PsbController from '../controllers/psb.controller.js';
const router = express.Router();

// 9PSB services
router.post('/bvn/verify', PsbController.verifyBVN);
router.post('/balance', PsbController.checkBalance);
router.post('/transfer', PsbController.transfer);
router.post('/account/validate', PsbController.validateAccount);


export default router;
