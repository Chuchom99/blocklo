import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import config from "../config/env.js";
import logger from "../config/logger.js";

// 9PSB WAAS (wallet-as-a-service) client.
// This module only talks to 9PSB. It never writes to the ledger: the payment
// intent service owns ledger rows and decides what to do with each outcome.

const BASE_URL = config.psb.baseUrl;

// Outcome of a money-moving call.
export const OUTCOME = { SUCCESS: "SUCCESS", FAILED: "FAILED", UNKNOWN: "UNKNOWN" };

const FAILED_STATUSES = ["FAILED", "FAILURE", "DECLINED", "REJECTED", "ERROR"];
const PENDING_STATUSES = ["PENDING", "PROCESSING", "IN_PROGRESS"];
// NIP codes meaning "not final yet": 09 pending, 91 issuer unavailable, 06 dormant/unknown, 25 unable to locate.
const PENDING_CODES = ["09", "91", "06", "25", "96", "97"];

// Decide what a 9PSB response means for the money. Only explicit success is SUCCESS;
// anything ambiguous is UNKNOWN so reconciliation resolves it instead of guessing.
export function classifyResponse(body) {
  if (!body || typeof body !== "object") return OUTCOME.UNKNOWN;
  const status = String(body.status ?? body.data?.status ?? "").toUpperCase();
  const code = String(body.data?.responseCode ?? body.responseCode ?? "");

  if (PENDING_STATUSES.includes(status) || PENDING_CODES.includes(code)) return OUTCOME.UNKNOWN;
  if (status === "SUCCESS" || status === "SUCCESSFUL" || body.data?.isSuccessful === true) {
    return code && code !== "00" ? OUTCOME.UNKNOWN : OUTCOME.SUCCESS;
  }
  if (FAILED_STATUSES.includes(status)) return OUTCOME.FAILED;
  if (code && code !== "00") return OUTCOME.FAILED;
  return OUTCOME.UNKNOWN;
}

// For status queries (TSQ) the top-level status only says the query worked;
// the original transaction's state lives inside `data`.
export function classifyStatusQuery(body) {
  const d = body?.data;
  if (!d || typeof d !== "object") return OUTCOME.UNKNOWN;
  const inner = {
    status: d.transactionStatus ?? d.status,
    data: { responseCode: d.responseCode, isSuccessful: d.isSuccessful },
  };
  if (inner.status == null && inner.data.responseCode == null && inner.data.isSuccessful == null) {
    return OUTCOME.UNKNOWN;
  }
  return classifyResponse(inner);
}

// Errors where the request certainly was not processed (bad request, auth rejected).
const wasRejected = (error) => [400, 401, 403, 404, 422].includes(error.response?.status);

class PsbService {
  static token = null;
  static tokenExpiry = 0;

  static async getWAASAuthToken(forceRefresh = false) {
    if (!forceRefresh && this.token && Date.now() < this.tokenExpiry) return this.token;

    const { username, password, clientId, clientSecret } = config.psb.waas;
    const response = await axios.post(
      `${BASE_URL}/authenticate`,
      { username, password, clientId, clientSecret },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 },
    );
    const token = response.data?.accessToken;
    if (!token) throw new Error("9PSB WAAS authentication returned no token");

    const ttlSeconds = Number(response.data?.expiresIn) || 600;
    this.token = token;
    // Refresh a minute early so a token never expires mid-request.
    this.tokenExpiry = Date.now() + Math.max(ttlSeconds - 60, 60) * 1000;
    return token;
  }

  // POST/GET with a cached token. A 401 means the call was rejected before
  // processing, so retrying once with a fresh token is safe even for payments.
  static async request(method, path, data, { timeout = 15000 } = {}) {
    const send = async (token) =>
      axios({
        method,
        url: `${BASE_URL}${path}`,
        data,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        timeout,
      });

    try {
      return (await send(await this.getWAASAuthToken())).data;
    } catch (error) {
      if (error.response?.status !== 401) throw error;
      return (await send(await this.getWAASAuthToken(true))).data;
    }
  }

  // For non-money calls: throw unless 9PSB says SUCCESS.
  static async call(method, path, data, label, opts) {
    try {
      const body = await this.request(method, path, data, opts);
      if (String(body?.status ?? "").toUpperCase() !== "SUCCESS") {
        throw new Error(`${label} failed: ${body?.message || body?.responseCode || "unknown error"}`);
      }
      return body;
    } catch (error) {
      logger.error(`[PSB] ${label} error [${error.response?.status || "no status"}]: ${error.message}`);
      throw new Error(`${label} failed`);
    }
  }

  static async createWallet(user) {
    const {
      firstName, lastName, email, phone, gender, dateOfBirth, address, placeOfBirth,
      ninUserId, nin, bvn, nextOfKinName, nextOfKinPhone, referralName, referralPhone, otherNames, trackingRef,
    } = user;

    if (!nin && !bvn) throw new Error("At least one of BVN or NIN is required by 9PSB");

    const payload = {
      // Stable per user so a retried request can be deduplicated by 9PSB.
      transactionTrackingRef: trackingRef || uuidv4(),
      lastName,
      otherNames: otherNames || firstName,
      accountName: `${firstName} ${lastName}`.trim(),
      phoneNo: phone,
      gender: gender ?? 0,
      dateOfBirth,
      address,
      placeOfBirth: placeOfBirth || "Nigeria",
      ...(bvn && { bvn }),
      ...(nin && { nin }),
      ...(ninUserId && { ninUserId }),
      nextOfKinName: nextOfKinName || "",
      nextOfKinPhoneNo: nextOfKinPhone || "",
      referralName: referralName || "",
      referralPhoneNo: referralPhone || "",
      email,
      otherAccountInformation: "Created via API Integration",
    };

    const body = await this.call("post", "/open_wallet", payload, "Wallet creation", { timeout: 20000 });
    const wallet = body.data || {};
    if (!wallet.accountNumber) throw new Error("Wallet creation failed: no account number returned");

    return {
      accountNumber: wallet.accountNumber,
      accountName: wallet.accountName || payload.accountName,
      currency: wallet.currency || "NGN",
    };
  }

  static async walletEnquiry(accountNo) {
    return this.call("post", "/wallet_enquiry", { accountNo }, "Wallet enquiry", { timeout: 10000 });
  }

  // Returns the available balance, or null when it can't be fetched. Callers must
  // treat null as "unknown", never as zero or as enough.
  static async getBalance(accountNo) {
    try {
      const body = await this.walletEnquiry(accountNo);
      const raw = body?.data?.availableBalance ?? body?.availableBalance;
      const amount = Number.parseFloat(String(raw).replace(/,/g, ""));
      return Number.isFinite(amount) ? amount : null;
    } catch {
      return null;
    }
  }

  // Wallet <-> client float account. Ops-only (admin routes); never reachable by end users.
  static async singleWalletTransfer({ accountNo, totalAmount, narration, merchant, type, transactionId }) {
    const payload = {
      accountNo,
      totalAmount: String(totalAmount),
      transactionId: transactionId || uuidv4().replace(/-/g, "").slice(0, 25),
      narration,
      merchant: {
        isFee: Boolean(merchant?.isFee),
        merchantFeeAmount: merchant?.isFee ? String(merchant.merchantFeeAmount || 0) : "0",
        merchantFeeAccount: merchant?.isFee ? merchant.merchantFeeAccount : "0000000000",
      },
      transactionType: "CREDIT_WALLET", // value 9PSB expects for both directions
    };
    const path = type === "credit" ? "/credit/transfer" : "/debit/transfer";
    return this.moveMoney(path, payload, payload.transactionId, `wallet ${type}`);
  }

  // Send money from a customer wallet to any bank account (including other 9PSB wallets).
  // `reference` must be the ledger reference so 9PSB can deduplicate and we can requery.
  static async walletToOtherBanks({
    reference, accountNo, amount, narration, destinationAccount, destinationBankCode, destinationName, senderName,
  }) {
    if (!reference) throw new Error("walletToOtherBanks requires a reference");

    const payload = {
      transaction: { reference },
      order: {
        amount: String(amount),
        currency: "NGN",
        description: `${narration} - Ref ${reference.slice(0, 8)}`,
        country: "NG",
      },
      customer: {
        account: {
          number: destinationAccount,
          bank: destinationBankCode,
          name: destinationName,
          senderaccountnumber: accountNo,
          sendername: senderName,
        },
      },
      merchant: { isFee: false, merchantFeeAccount: "0000000000", merchantFeeAmount: "0" },
      transactionType: "INTRA_BANK",
      narration,
      merchantBearsFee: false,
    };

    return this.moveMoney("/wallet_other_banks", payload, reference, "transfer");
  }

  // Single attempt, no automatic retry: a retry after a timeout could pay twice.
  static async moveMoney(path, payload, reference, label) {
    try {
      const body = await this.request("post", path, payload, { timeout: 45000 });
      const outcome = classifyResponse(body);
      logger.info(`[PSB] ${label} ${reference}: ${outcome}`);
      return { outcome, providerRef: body?.data?.reference || body?.data?.sessionId || null, raw: body };
    } catch (error) {
      const outcome = wasRejected(error) ? OUTCOME.FAILED : OUTCOME.UNKNOWN;
      logger.error(`[PSB] ${label} ${reference} error [${error.response?.status || error.code || "no status"}]: ${outcome}`);
      return { outcome, providerRef: null, raw: error.response?.data ?? { error: error.code || error.message } };
    }
  }

  static async getTransactionHistory(accountNumber, fromDate, toDate, numberOfItems = "50") {
    return this.call(
      "post",
      "/wallet_transactions",
      { accountNumber, fromDate, toDate, numberOfItems: String(numberOfItems) },
      "Transaction history",
    );
  }

  // Transaction status query. Returns the classified outcome of the original transaction.
  static async requeryTransaction({ transactionId, amount, transactionType, transactionDate, accountNo }) {
    try {
      const body = await this.request("post", "/wallet_requery", {
        transactionId,
        amount: Number(amount),
        transactionType,
        transactionDate,
        accountNo,
      });
      return { outcome: classifyStatusQuery(body), raw: body };
    } catch (error) {
      logger.warn(`[PSB] requery ${transactionId} failed [${error.response?.status || error.code}]`);
      return { outcome: OUTCOME.UNKNOWN, raw: null };
    }
  }

  // Resolve the account holder's name for a bank account. Returns null when it can't.
  static async otherBankEnquiry(accountNumber, bankCode) {
    try {
      const body = await this.request(
        "post",
        "/other_banks_enquiry",
        { customer: { account: { number: accountNumber }, bank: bankCode } },
        { timeout: 10000 },
      );
      if (String(body?.status ?? "").toUpperCase() !== "SUCCESS") return null;
      const d = body.data || {};
      return d.accountName || d.customer?.account?.name || d.name || null;
    } catch (error) {
      logger.warn(`[PSB] name enquiry failed [${error.response?.status || error.code}]`);
      return null;
    }
  }

  static async getWalletStatus(accountNo) {
    return this.call("post", "/wallet_status", { accountNo }, "Wallet status");
  }

  static async changeWalletStatus(accountNumber, accountStatus) {
    if (!["ACTIVE", "SUSPENDED"].includes(accountStatus)) {
      throw new Error("accountStatus must be ACTIVE or SUSPENDED");
    }
    return this.call("post", "/change_wallet_status", { accountNumber, accountStatus }, "Change wallet status");
  }

  static async getBanks() {
    return (await this.call("get", "/get_banks", undefined, "Get banks")).data;
  }

  // Confirm an inbound-transfer notification really happened before crediting anyone.
  static async notificationRequery(sessionID, accountNumber) {
    return this.call("post", "/notification_requery", { sessionID, accountNumber }, "Notification requery");
  }

  static async getWalletByBVN(bvn) {
    return (await this.call("post", "/get_wallet", { bvn }, "Get wallet by BVN")).data;
  }
}

export default PsbService;
