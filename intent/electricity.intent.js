import PsbVasService from "../services/psb.vas.services.js";
import { draftAndConfirm } from "../services/payment-intent.service.js";
import { buildBill } from "../services/payment-builder.service.js";
import { clearState, setState } from "../services/conversation.state.js";
import { MIN_ELECTRICITY_AMOUNT } from "../utils/constant.js";
import { naira, parseAmount } from "../utils/format.js";
import { listMessage } from "./list.js";

const ELECTRICITY_CATEGORY_ID = "1";
const POPULAR = ["BP-IKEJA", "BP-EKO", "BP-ABUJA", "BP-ENUGU", "BP-PH", "BP-KADUNA", "BP-IBADAN", "BP-KANO", "BP-JOS", "BP-BENIN"];
const START = /\b(electricity|light bill|nepa|phcn|disco|prepaid meter|buy light|pay light|meter token)\b/i;

export class ElectricityBillService {
  static async start(ctx, input) {
    if (!START.test(input)) return null;

    let billers;
    try {
      billers = (await PsbVasService.getCategoryBillers(ELECTRICITY_CATEGORY_ID))?.data || [];
    } catch {
      return "Electricity providers are temporarily unavailable. Please try again in a few minutes.";
    }
    if (!billers.length) return "Electricity providers are temporarily unavailable.";

    const sorted = [...billers].sort((a, b) => rank(a.id) - rank(b.id));
    await setState(ctx.from, {
      intent: "electricity",
      step: "disco",
      discos: sorted.map((b) => ({ id: b.id, name: b.name })),
    });

    return listMessage(
      "⚡ *Pay for electricity*\n\nSelect your provider, or type its name (e.g. Ikeja, Eko, AEDC).\nReply *cancel* to stop.",
      "Choose provider",
      sorted.slice(0, 10).map((b) => ({ id: `DISCO_${b.id}`, title: b.name })),
    );
  }

  static async continue(ctx, input, state) {
    const text = input.trim();

    if (state.step === "disco") {
      const lower = text.toLowerCase();
      const disco = text.startsWith("DISCO_")
        ? state.discos.find((d) => `DISCO_${d.id}` === text)
        : state.discos.find((d) => d.name.toLowerCase().includes(lower) || d.id.toLowerCase().includes(lower));
      if (!disco) return "I don't recognise that provider. Please pick one from the list or type its name.";
      await setState(ctx.from, { intent: "electricity", step: "meter", billerId: disco.id, billerName: disco.name });
      return `*${disco.name}* selected.\n\nSend your meter number.`;
    }

    if (state.step === "meter") {
      if (!/^\d{10,15}$/.test(text)) return "That doesn't look like a meter number. Please send 10–15 digits.";
      await setState(ctx.from, { ...state, step: "amount", meterNumber: text });
      return `Meter: *${text}*\n\nHow much electricity do you want to buy? (minimum ${naira(MIN_ELECTRICITY_AMOUNT)})`;
    }

    if (state.step === "amount") {
      const amount = parseAmount(text);
      if (!amount || amount < MIN_ELECTRICITY_AMOUNT) {
        return `Please enter an amount of at least ${naira(MIN_ELECTRICITY_AMOUNT)}.`;
      }
      return this.confirm(ctx, { ...state, amount });
    }

    await clearState(ctx.from);
    return null;
  }

  static async confirm(ctx, flow) {
    await clearState(ctx.from);
    return draftAndConfirm(ctx, () =>
      buildBill(ctx, { type: "electricity", billerId: flow.billerId, customerId: flow.meterNumber, amount: flow.amount }),
    );
  }
}

function rank(id) {
  const i = POPULAR.indexOf(id);
  return i === -1 ? POPULAR.length : i;
}

export default ElectricityBillService;
