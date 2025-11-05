import express from "express";
import PsbVasController from "../controllers/psb.vas.controller.js";

const router = express.Router();

// 🔹 Topup Services
router.get("/topup/network", PsbVasController.getNetwork);
router.post("/topup/airtime", PsbVasController.buyAirtime);
router.get("/topup/dataPlans", PsbVasController.getDataPlans);
router.post("/topup/data", PsbVasController.buyData);
router.get("/topup/status", PsbVasController.getTopupStatus);

// 🔹 Bills Payment
router.get("/billspayment/categories", PsbVasController.getCategories);
router.get("/billspayment/billers/:categoryId", PsbVasController.getCategoryBillers);
router.get("/billspayment/fields/:billerId", PsbVasController.getBillerFields);
router.post("/billspayment/validate", PsbVasController.validateBillerInput);
router.post("/billspayment/pay", PsbVasController.payBill);
router.get("/billspayment/status", PsbVasController.getBillStatus);

export default router;
