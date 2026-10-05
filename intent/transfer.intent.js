import { BankService } from "../services/bank.service.js";
import { BeneficiaryService } from "../services/beneficiary.service.js";
import { buildTransfer } from "../services/payment-builder.service.js";
import { draftAndConfirm } from "../services/payment-intent.service.js";
import { clearState, setState } from "../services/conversation.state.js";
import { maskAccount, parseAmount } from "../utils/format.js";

// "send 5000 to 0123456789 gtbank" | "transfer 2,000 to 0123456789" | "send 1500 to mom"
const TO_ACCOUNT = /^(?:send|transfer|pay|xfer)\s+₦?([\d,]+(?:\.\d{1,2})?)\s+(?:naira\s+)?to\s+(\d{10})(?:\s+(?:at\s+|in\s+|bank\s+)?(.+))?$/i;
const TO_ALIAS = /^(?:send|transfer|pay)\s+₦?([\d,]+(?:\.\d{1,2})?)\s+(?:naira\s+)?to\s+([a-z][a-z0-9 ]{0,29})$/i;

export default class TransferIntentService {
  static async start(ctx, input) {
    const text = input.trim();

    const toAccount = text.match(TO_ACCOUNT);
    if (toAccount) {
      const amount = parseAmount(toAccount[1]);
      if (!amount) return "Please enter a valid amount, e.g. *send 5000 to 0123456789 GTBank*.";
      return this.withBank(ctx, { amount, accountNumber: toAccount[2], bankInput: toAccount[3] });
    }

    const toAlias = text.match(TO_ALIAS);
    if (toAlias) {
      const amount = parseAmount(toAlias[1]);
      const beneficiary = amount && (await BeneficiaryService.findByAlias(ctx.user.id, toAlias[2]));
      if (!beneficiary) return null; // not a saved alias: let other handlers / the assistant answer
      return this.confirm(ctx, {
        amount,
        accountNumber: beneficiary.accountNo,
        bank: { code: beneficiary.bankCode, name: beneficiary.bankName },
      });
    }

    return null;
  }

  static async continue(ctx, input, state) {
    if (state.step === "bank") {
      return this.withBank(ctx, { amount: state.amount, accountNumber: state.accountNumber, bankInput: input });
    }
    await clearState(ctx.from);
    return null;
  }

  static async withBank(ctx, { amount, accountNumber, bankInput }) {
    if (!bankInput) {
      await setState(ctx.from, { intent: "transfer", step: "bank", amount, accountNumber });
      return `Which bank is ${maskAccount(accountNumber)} with?\n(e.g. GTBank, Access, Zenith, 9PSB)\n\nReply *cancel* to stop.`;
    }
    const bank = await BankService.findCode(bankInput);
    if (!bank) {
      await setState(ctx.from, { intent: "transfer", step: "bank", amount, accountNumber });
      return `I couldn't find the bank "${bankInput}". Please type the bank name again (e.g. GTBank, Access Bank, 9PSB).`;
    }
    return this.confirm(ctx, { amount, accountNumber, bank });
  }

  static async confirm(ctx, { amount, accountNumber, bank }) {
    await clearState(ctx.from);
    return draftAndConfirm(ctx, () => buildTransfer(ctx, { amount, accountNumber, bank }));
  }
}
