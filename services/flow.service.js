import Joi from "joi";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import UserService from "./user.service.js";
import WhatsAppService from "./whatsapp.services.js";
import { authorize, cancel } from "./payment-intent.service.js";
import {
  consumeRegistrationToken,
  parseToken,
  resolveRegistrationToken,
  verifyPaymentToken,
} from "./flow-token.service.js";
import { naira } from "../utils/format.js";

// Business logic behind POST /api/whatsapp/flow (already decrypted by the controller).
// Screens referenced here are defined in flows/*.flow.json.

export class FlowTokenError extends Error {}

const close = (flowToken, status) => ({
  screen: "SUCCESS",
  data: { extension_message_response: { params: { flow_token: flowToken, status } } },
});
const info = (title, message) => ({ screen: "INFO", data: { title, message } });

export async function handleFlowRequest(body) {
  const { action, flow_token: flowToken, data } = body;

  if (action === "ping") return { data: { status: "active" } };
  // Client-side error notification from Meta: acknowledge only.
  if (data?.error) {
    logger.warn(`[FLOW] client error notification: ${data.error}`);
    return { data: { acknowledged: true } };
  }

  const token = parseToken(flowToken);
  if (!token) throw new FlowTokenError("malformed flow token");
  return token.type === "pay"
    ? handlePayment(token, flowToken, action, data)
    : handleRegistration(token, flowToken, action, data);
}

async function handlePayment(token, flowToken, action, data) {
  const intent = await prisma.paymentIntent.findUnique({ where: { id: token.id }, include: { user: true } });
  if (!intent || !verifyPaymentToken(token, intent.user.whatsappId)) throw new FlowTokenError("bad payment token");

  const confirm = (errorText = "") => ({
    screen: "CONFIRM",
    data: { summary: intent.summary, amount: naira(intent.amount), error_text: errorText, has_error: Boolean(errorText) },
  });

  if (intent.status !== "DRAFT" || intent.expiresAt <= new Date()) {
    return info("Request closed", "This payment request has expired or was already used. Please start again in chat.");
  }
  if (action === "INIT" || action === "BACK") return confirm();
  if (action !== "data_exchange") return confirm();

  if (data?.cancel) {
    await cancel(intent.id, intent.userId);
    return close(flowToken, "cancelled");
  }

  const result = await authorize({ intentId: intent.id, userId: intent.userId, pin: data?.pin });
  if (result.ok) return close(flowToken, "authorized");

  switch (result.reason) {
    case "WRONG":
      return confirm(`Incorrect PIN. ${result.remaining} attempt${result.remaining === 1 ? "" : "s"} left.`);
    case "LOCKED":
      return info(
        "PIN locked",
        `Too many incorrect attempts. You can try again after ${result.lockedUntil.toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" })}.`,
      );
    case "NO_PIN":
      return info("No PIN set", "Your account has no transaction PIN. Please contact support.");
    default:
      return info("Request closed", "This payment request has expired or was already used. Please start again in chat.");
  }
}

// Flow DatePicker sends "YYYY-MM-DD"; 9PSB expects "dd/MM/yyyy".
const registrationSchema = Joi.object({
  first_name: Joi.string().trim().min(2).max(50).required(),
  last_name: Joi.string().trim().min(2).max(50).required(),
  email: Joi.string().trim().email().required(),
  date_of_birth: Joi.date().iso().less("now").required(),
  address: Joi.string().trim().min(5).max(100).required(),
  gender: Joi.string().valid("0", "1").required(),
  bvn: Joi.string().pattern(/^\d{11}$/).allow("", null),
  nin: Joi.string().pattern(/^\d{11}$/).allow("", null),
  pin: Joi.string().pattern(/^\d{4}$/).required(),
  confirm_pin: Joi.string().valid(Joi.ref("pin")).required().messages({ "any.only": "PINs do not match" }),
  terms_agreement: Joi.boolean().valid(true).required().messages({ "any.only": "You must accept the terms" }),
})
  .or("bvn", "nin")
  .unknown(true);

const toDdMmYyyy = (date) => {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

async function handleRegistration(token, flowToken, action, data) {
  const waId = await resolveRegistrationToken(token);
  if (!waId) throw new FlowTokenError("bad registration token");

  const form = (errorText = "") => ({ screen: "REGISTER", data: { error_text: errorText, has_error: Boolean(errorText) } });
  if (action !== "data_exchange") return form();

  if (await UserService.findByWhatsappId(waId)) {
    await consumeRegistrationToken(token);
    return info("Already registered", "This WhatsApp number already has an account. Say *balance* in chat.");
  }

  const { value, error } = registrationSchema.validate(data || {}, { abortEarly: true, convert: true });
  if (error) return form(error.details[0].message.replace(/"/g, ""));

  try {
    await UserService.register(
      {
        firstName: value.first_name,
        lastName: value.last_name,
        email: value.email,
        dateOfBirth: toDdMmYyyy(value.date_of_birth),
        address: value.address,
        gender: Number(value.gender),
        bvn: value.bvn || null,
        nin: value.nin || null,
        pin: value.pin,
        termsAgreed: true,
      },
      { whatsappId: waId },
    );
  } catch (err) {
    if (err.expose) return form(err.message);
    throw err;
  }

  await consumeRegistrationToken(token);
  WhatsAppService.sendMessage(waId, "Thanks! We're opening your account now. You'll get your account number here shortly.").catch(() => {});
  return close(flowToken, "registered");
}
