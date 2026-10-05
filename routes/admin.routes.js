import express from "express";
import AdminController from "../controllers/admin.controller.js";
import { requireAdmin } from "../middlwares/requireAdmin.js";

const router = express.Router();
router.use(requireAdmin);

router.post("/psb/wallet/enquiry", AdminController.walletEnquiry);
router.post("/psb/wallet/status", AdminController.walletStatus);
router.post("/psb/wallet/change-status", AdminController.changeWalletStatus);
router.post("/psb/wallet/by-bvn", AdminController.walletByBvn);
router.post("/psb/wallet/transactions", AdminController.walletHistory);
router.post("/psb/wallet/float-transfer", AdminController.floatTransfer);
router.post("/psb/notification/requery", AdminController.notificationRequery);

router.get("/transactions/review", AdminController.reviewQueue);
router.post("/transactions/:reference/requery", AdminController.requery);

export default router;
