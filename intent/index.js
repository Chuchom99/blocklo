// import { VasIntentService } from "../services/vas-intent-services.js";
import { BillsIntentService } from "../services/bills.intent.services.js";
import TransferIntentService from "./transfer.intent.js";
import TransactionHistoryService from "./transaction.history.intent.js";
import {BeneficiaryIntentService} from "./beneficiary.intent.js";
import VasIntentService from "./vas.intent.js";
import ElectricityBillService from "./electricity.intent.js";
import CableTVService from "./cabletv.intent.js";

export {
  BillsIntentService,
  TransferIntentService,
  TransactionHistoryService,
  BeneficiaryIntentService,
  VasIntentService,
  ElectricityBillService,
  CableTVService
};
