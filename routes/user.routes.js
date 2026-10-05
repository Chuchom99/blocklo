import express from "express";
import UserController from "../controllers/user.controller.js";
import { requireAuth } from "../middlwares/requireAuth.js";
import { rateLimit } from "../middlwares/ratelimit.middleware.js";

const router = express.Router();

router.post("/register", rateLimit({ name: "register", max: 5, windowSec: 3600 }), UserController.register);
router.post(
  "/login",
  rateLimit({ name: "login-ip", max: 20, windowSec: 900 }),
  rateLimit({ name: "login-id", max: 5, windowSec: 900, key: (req) => req.body?.identifier }),
  UserController.login,
);
router.post("/refresh", rateLimit({ name: "refresh", max: 30, windowSec: 900 }), UserController.refresh);
router.post("/logout", requireAuth, UserController.logout);
router.get("/me", requireAuth, UserController.me);

export default router;
