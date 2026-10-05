import PsbVasService from "../services/psb.vas.services.js";
import { draftAndConfirm } from "../services/payment-intent.service.js";
import { buildAirtime, buildData } from "../services/payment-builder.service.js";
import { clearState, setState } from "../services/conversation.state.js";
import { naira, parseAmount } from "../utils/format.js";
import { isNigerianMobile, toLocalPhone } from "../utils/phone.js";
import { listMessage } from "./list.js";

// "buy 500 airtime for 08012345678" | "recharge 1000 08012345678" | "airtime"
const AIRTIME_FULL = /^(?:buy|recharge|send)\s+₦?([\d,]+)\s*(?:naira\s*)?(?:airtime|credit)?\s*(?:for|to)?\s*(\+?\d{10,13}|me|myself)$/i;
const AIRTIME_START = /\b(airtime|recharge card|recharge)\b/i;
const DATA_START = /\b(data|bundle)\b/i;
const PHONE_IN_TEXT = /(\+?234\d{10}|0[789]\d{9})/;

const resolvePhone = (ctx, raw) => (/^(me|myself)$/i.test(raw.trim()) ? ctx.user.phone : toLocalPhone(raw));

export class VasIntentService {
  static async start(ctx, input) {
    const text = input.trim();

    const full = text.match(AIRTIME_FULL);
    if (full) {
      const amount = parseAmount(full[1]);
      const phone = resolvePhone(ctx, full[2]);
      if (!amount) return "Please enter a valid amount.";
      if (!isNigerianMobile(phone)) return "Please send a valid Nigerian number, e.g. 08012345678.";
      return this.confirmAirtime(ctx, phone, amount);
    }

    if (AIRTIME_START.test(text)) {
      await setState(ctx.from, { intent: "vas", flow: "airtime", step: "phone" });
      return "📱 Which number should I recharge?\nReply with the number, or *me* for your own.";
    }

    if (DATA_START.test(text)) {
      const phone = text.match(PHONE_IN_TEXT)?.[1];
      if (phone) return this.showDataPlans(ctx, toLocalPhone(phone));
      await setState(ctx.from, { intent: "vas", flow: "data", step: "phone" });
      return "📶 Which number is the data for?\nReply with the number, or *me* for your own.";
    }

    return null;
  }

  static async continue(ctx, input, state) {
    const text = input.trim();

    if (state.step === "phone") {
      const phone = resolvePhone(ctx, text);
      if (!isNigerianMobile(phone)) return "Please send a valid Nigerian number, e.g. 08012345678, or *me*.";
      if (state.flow === "data") return this.showDataPlans(ctx, phone);
      await setState(ctx.from, { intent: "vas", flow: "airtime", step: "amount", phone });
      return `How much airtime for ${phone}? (e.g. 500)`;
    }

    if (state.flow === "airtime" && state.step === "amount") {
      const amount = parseAmount(text);
      if (!amount) return "Please enter a valid amount, e.g. 500.";
      return this.confirmAirtime(ctx, state.phone, amount);
    }

    if (state.flow === "data" && state.step === "plan") {
      const n = Number.parseInt(text, 10);
      const plan = text.startsWith("DATA_")
        ? state.plans.find((p) => `DATA_${p.productId}` === text)
        : state.plans[n - 1];
      if (!plan) return "Please pick a plan from the list.";
      return this.confirmData(ctx, state.phone, plan);
    }

    await clearState(ctx.from);
    return null;
  }

  static async confirmAirtime(ctx, phone, amount) {
    await clearState(ctx.from);
    return draftAndConfirm(ctx, () => buildAirtime(ctx, { phoneNumber: phone, amount }));
  }

  static async showDataPlans(ctx, phone) {
    const [plans, { name: network }] = await Promise.all([
      PsbVasService.getDataPlans(phone),
      PsbVasService.detectNetwork(phone),
    ]);
    if (!plans.length) {
      await clearState(ctx.from);
      return "No data plans are available for that number right now. Please try again later.";
    }

    const sorted = [...plans].sort((a, b) => a.price - b.price).slice(0, 10);
    await setState(ctx.from, { intent: "vas", flow: "data", step: "plan", phone, network, plans: sorted });

    const text = sorted.map((p, i) => `${i + 1}. ${p.size} — ${naira(p.price)}${p.validity ? ` (${p.validity})` : ""}`).join("\n");
    return listMessage(
      `📶 *${network} data plans for ${phone}*\n\n${text}\n\nPick a plan or reply with its number.`,
      "Choose plan",
      sorted.map((p) => ({ id: `DATA_${p.productId}`, title: String(p.size), description: `${naira(p.price)} ${p.validity || ""}`.trim() })),
    );
  }

  static async confirmData(ctx, phone, plan) {
    await clearState(ctx.from);
    // Re-resolved from 9PSB so the price can't come from stale state.
    return draftAndConfirm(ctx, () => buildData(ctx, { phoneNumber: phone, productId: plan.productId }));
  }
}

export default VasIntentService;
