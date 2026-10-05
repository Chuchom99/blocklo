import Joi from "joi";
import UserService from "../services/user.service.js";
import * as AuthService from "../services/auth.service.js";
import { audit } from "../services/audit.service.js";
import { badRequest, unauthorized } from "../utils/errors.js";
import { publicAccount, publicUser } from "../utils/serialize.js";

const validate = (schema, body) => {
  const { value, error } = schema.validate(body, { abortEarly: true, stripUnknown: true });
  if (error) throw badRequest(error.details[0].message.replace(/"/g, ""), "VALIDATION");
  return value;
};

const registerSchema = Joi.object({
  email: Joi.string().trim().email().required(),
  phone: Joi.string().pattern(/^(\+?234|0)[789]\d{9}$/).required().messages({ "string.pattern.base": "Enter a valid Nigerian phone number" }),
  password: Joi.string().min(10).max(128).required(),
  firstName: Joi.string().trim().min(2).max(50).required(),
  lastName: Joi.string().trim().min(2).max(50).required(),
  pin: Joi.string().pattern(/^\d{4}$/).required(),
  termsAgreed: Joi.boolean().valid(true).required(),
  gender: Joi.number().valid(0, 1).required(),
  dateOfBirth: Joi.string().pattern(/^\d{2}\/\d{2}\/\d{4}$/).required().messages({ "string.pattern.base": "dateOfBirth must be dd/MM/yyyy" }),
  address: Joi.string().trim().min(5).max(100).required(),
  ninUserId: Joi.string().pattern(/^[A-Z]{6}-\d{4}$/).optional(),
  nin: Joi.string().pattern(/^\d{11}$/).optional(),
  bvn: Joi.string().pattern(/^\d{11}$/).optional(),
}).or("bvn", "nin");
// No whatsappId here: linking a WhatsApp number must be proven from that number.

const loginSchema = Joi.object({
  identifier: Joi.string().trim().max(254).required(),
  password: Joi.string().max(128).required(),
});

const meta = (req) => ({ ip: req.ip, userAgent: req.get("user-agent") });

class UserController {
  static async register(req, res) {
    const user = await UserService.register(validate(registerSchema, req.body));
    res.status(201).json({
      success: true,
      message: "Account created. Your wallet is being opened.",
      user: publicUser(user),
    });
  }

  static async login(req, res) {
    const { identifier, password } = validate(loginSchema, req.body);
    const user = await UserService.findByIdentifier(identifier);

    // Same response for unknown user and wrong password, so logins can't probe for accounts.
    if (!user || !(await UserService.verifyPassword(user, password)) || user.status === "BLOCKED") {
      await audit(user?.id || "unknown", "auth.login_failed", { ip: req.ip });
      throw unauthorized("Invalid credentials");
    }

    const tokens = await AuthService.startSession(user.id, meta(req));
    await audit(user.id, "auth.login", { ip: req.ip });
    res.json({ success: true, user: publicUser(user), ...tokens });
  }

  static async refresh(req, res) {
    const tokens = await AuthService.refresh(String(req.body?.refreshToken || ""), meta(req));
    if (!tokens) throw unauthorized("Invalid refresh token");
    res.json({ success: true, ...tokens });
  }

  static async logout(req, res) {
    await AuthService.logout(req.sessionId);
    res.json({ success: true });
  }

  static async me(req, res) {
    res.json({ success: true, user: publicUser(req.user), account: publicAccount(req.user.accounts[0]) });
  }
}

export default UserController;
