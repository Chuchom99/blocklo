import express from "express";
import MeController from "../controllers/me.controller.js";
import { requireAuth } from "../middlwares/requireAuth.js";
import { rateLimit } from "../middlwares/ratelimit.middleware.js";

const router = express.Router();
router.use(requireAuth);

router.get("/balance", MeController.balance);
router.get("/transactions", MeController.transactions);
router.get("/transactions/:id/receipt", MeController.receipt);
router.get("/banks", MeController.banks);
router.get("/data-plans", MeController.dataPlans);

router.get("/beneficiaries", MeController.beneficiaries);
router.post("/beneficiaries", MeController.saveBeneficiary);
router.delete("/beneficiaries/:alias", MeController.deleteBeneficiary);

router.post("/payments", rateLimit({ name: "payments", max: 30, windowSec: 3600 }), MeController.createPayment);
router.get("/payments/:id", MeController.getPayment);
router.post("/payments/:id/authorize", rateLimit({ name: "authorize", max: 10, windowSec: 900 }), MeController.authorizePayment);
router.post("/payments/:id/cancel", MeController.cancelPayment);

export default router;
