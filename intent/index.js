import TransferIntentService from "./transfer.intent.js";
import TransactionHistoryService from "./transaction.history.intent.js";
import { BeneficiaryIntentService } from "./beneficiary.intent.js";
import VasIntentService from "./vas.intent.js";
import ElectricityBillService from "./electricity.intent.js";
import CableTVService from "./cabletv.intent.js";

// Keyed by the `intent` value stored in conversation state.
export const FLOWS = {
  transfer: TransferIntentService,
  beneficiary: BeneficiaryIntentService,
  history: TransactionHistoryService,
  electricity: ElectricityBillService,
  tv: CableTVService,
  vas: VasIntentService,
};

// Order matters: the most specific patterns go first.
export const STARTERS = [
  BeneficiaryIntentService,
  TransferIntentService,
  ElectricityBillService,
  CableTVService,
  VasIntentService,
  TransactionHistoryService,
];
