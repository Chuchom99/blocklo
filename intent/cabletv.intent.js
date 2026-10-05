import PsbVasService from "../services/psb.vas.services.js";
import { draftAndConfirm } from "../services/payment-intent.service.js";
import { buildBill } from "../services/payment-builder.service.js";
import { clearState, setState } from "../services/conversation.state.js";
import { naira } from "../utils/format.js";
import { listMessage } from "./list.js";

const PROVIDERS = [
  { id: "CW-DSTV", name: "DSTV" },
  { id: "CW-GOTV", name: "GOtv" },
  { id: "CW-STARTIMES", name: "StarTimes" },
];
const START = /\b(dstv|gotv|startimes|cable tv|cable|tv subscription|bouquet)\b/i;

export class CableTVService {
  static async start(ctx, input) {
    const match = input.match(START);
    if (!match) return null;

    // "pay dstv" goes straight to the smart card step.
    const direct = PROVIDERS.find((p) => p.name.toLowerCase() === match[1].toLowerCase());
    if (direct) return this.askSmartcard(ctx, direct);

    await setState(ctx.from, { intent: "tv", step: "provider" });
    return {
      type: "interactive",
      payload: {
        type: "button",
        body: { text: "📺 *Pay for cable TV*\n\nSelect your provider." },
        action: { buttons: PROVIDERS.map((p) => ({ type: "reply", reply: { id: `TV_${p.id}`, title: p.name } })) },
      },
    };
  }

  static async askSmartcard(ctx, provider) {
    await setState(ctx.from, { intent: "tv", step: "smartcard", billerId: provider.id, billerName: provider.name });
    return `*${provider.name}* selected.\n\nSend your smart card / IUC number.`;
  }

  static async continue(ctx, input, state) {
    const text = input.trim();

    if (state.step === "provider") {
      const provider = PROVIDERS.find((p) => `TV_${p.id}` === text || p.name.toLowerCase() === text.toLowerCase());
      if (!provider) return "Please choose DSTV, GOtv or StarTimes.";
      return this.askSmartcard(ctx, provider);
    }

    if (state.step === "smartcard") {
      if (!/^\d{10,12}$/.test(text)) return "That doesn't look right. Smart card numbers are 10–12 digits.";
      return this.showBouquets(ctx, { ...state, smartcard: text });
    }

    if (state.step === "bouquet") {
      const n = Number.parseInt(text, 10);
      const bouquet = text.startsWith("BOUQUET_")
        ? state.bouquets.find((b) => `BOUQUET_${b.itemId}` === text)
        : state.bouquets[n - 1];
      if (!bouquet) return "Please pick a bouquet from the list.";
      return this.confirm(ctx, state, bouquet);
    }

    await clearState(ctx.from);
    return null;
  }

  static async showBouquets(ctx, state) {
    let items = [];
    try {
      const fields = await PsbVasService.getBillerFields(state.billerId);
      items = fields?.data?.find((f) => f.fieldName === "itemId")?.items || [];
    } catch {
      await clearState(ctx.from);
      return "Couldn't load bouquets right now. Please try again.";
    }

    // Prices come from 9PSB and are stored server-side; the user only picks an item.
    const bouquets = items
      .map((b) => ({ itemId: String(b.itemId), name: b.itemName, amount: Number.parseFloat(b.amount) }))
      .filter((b) => b.itemId && Number.isFinite(b.amount) && b.amount > 0);
    if (!bouquets.length) {
      await clearState(ctx.from);
      return "No bouquets are available right now.";
    }

    await setState(ctx.from, { ...state, step: "bouquet", bouquets });
    const text = bouquets.map((b, i) => `${i + 1}. ${b.name} — ${naira(b.amount)}`).join("\n");
    return listMessage(
      `Smart card: *${state.smartcard}*\n\n${text}\n\nPick a bouquet or reply with its number.`,
      "Choose bouquet",
      bouquets.map((b) => ({ id: `BOUQUET_${b.itemId}`, title: b.name.split(" - ")[0], description: naira(b.amount) })),
    );
  }

  static async confirm(ctx, state, bouquet) {
    await clearState(ctx.from);
    return draftAndConfirm(ctx, () =>
      buildBill(ctx, { type: "tv", billerId: state.billerId, customerId: state.smartcard, itemId: bouquet.itemId }),
    );
  }
}

export default CableTVService;
