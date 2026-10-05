import { BeneficiaryService } from "../services/beneficiary.service.js";
import { clearState, setState } from "../services/conversation.state.js";
import { hit } from "../utils/rateLimit.js";

const SAVE = /^save\s+([a-z][a-z0-9]{0,29})\s+(\d{10})\s+(.+)$/i;
const DELETE = /^(?:delete|remove)\s+(?:beneficiary\s+)?([a-z][a-z0-9]{0,29})$/i;
const LIST = /^(?:my\s+)?(?:beneficiar(?:y|ies)|saved(?:\s+accounts)?|list beneficiaries)$/i;

export class BeneficiaryIntentService {
  static async start(ctx, input) {
    const text = input.trim();

    const save = text.match(SAVE);
    if (save) {
      if (!(await hit(`enquiry:${ctx.user.id}`, 20, 3600)).allowed) {
        return "You've checked a lot of accounts in a short time. Please try again later.";
      }
      return BeneficiaryService.save(ctx.user.id, save[1], save[2], save[3]);
    }

    if (LIST.test(text)) return BeneficiaryService.list(ctx.user.id);

    const del = text.match(DELETE);
    if (del) return this.requestDelete(ctx, del[1]);

    return null;
  }

  static async requestDelete(ctx, alias) {
    const beneficiary = await BeneficiaryService.findByAlias(ctx.user.id, alias);
    if (!beneficiary) return `No saved beneficiary called "${alias}".`;
    await setState(ctx.from, { intent: "beneficiary", step: "confirm_delete", alias: beneficiary.alias }, 300);
    return {
      type: "interactive",
      payload: {
        type: "button",
        body: { text: `Remove *${beneficiary.alias.toUpperCase()}* (${beneficiary.accountName}) from your beneficiaries?` },
        action: {
          buttons: [
            { type: "reply", reply: { id: "BENDEL_YES", title: "Yes, remove" } },
            { type: "reply", reply: { id: "BENDEL_NO", title: "No, keep" } },
          ],
        },
      },
    };
  }

  static async continue(ctx, input, state) {
    await clearState(ctx.from);
    if (state.step === "confirm_delete" && input === "BENDEL_YES") {
      return (await BeneficiaryService.remove(ctx.user.id, state.alias))
        ? `${state.alias.toUpperCase()} has been removed.`
        : "That beneficiary no longer exists.";
    }
    return "OK, nothing was changed.";
  }
}
