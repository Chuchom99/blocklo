import axios from "axios";
import config from "../config/env.js";
import logger from "../config/logger.js";
import { OUTCOME, classifyResponse, classifyStatusQuery } from "./psb.service.js";
import { toLocalPhone } from "../utils/phone.js";

// 9PSB VAS (airtime, data, bills) client. Like PsbService it never touches the
// ledger; purchases take the ledger reference and return a classified outcome.

const VAS_BASE_URL = config.psb.vasBaseUrl;
const IDENTITY_BASE_URL = config.psb.identityBaseUrl;

const wasRejected = (error) => [400, 401, 403, 404, 422].includes(error.response?.status);

class PsbVasService {
  static cachedToken = null;
  static tokenExpiry = 0;
  static networkCache = new Map();

  static async getVASAuthToken(forceRefresh = false) {
    if (!forceRefresh && this.cachedToken && Date.now() < this.tokenExpiry) return this.cachedToken;

    const response = await axios.post(
      `${IDENTITY_BASE_URL}/authenticate`,
      { username: config.psb.vas.apiKey, password: config.psb.vas.secretKey },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 },
    );
    const data = response.data;
    if (String(data?.status).toLowerCase() !== "success" || !data?.data?.accessToken) {
      throw new Error("VAS authentication failed");
    }

    // expiresIn is in seconds; refresh a minute early.
    const ttlSeconds = Number(data.data.expiresIn) || 7200;
    this.cachedToken = data.data.accessToken;
    this.tokenExpiry = Date.now() + Math.max(ttlSeconds - 60, 60) * 1000;
    return this.cachedToken;
  }

  static async makeRequest(method, endpoint, payload, { timeout = 25000 } = {}) {
    const send = async (token) =>
      axios({
        method,
        url: `${VAS_BASE_URL}${endpoint}`,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        data: payload,
        timeout,
      });

    try {
      return (await send(await this.getVASAuthToken())).data;
    } catch (error) {
      if (error.response?.status !== 401) throw error;
      return (await send(await this.getVASAuthToken(true))).data;
    }
  }

  // Read-only call: throws a generic error on failure.
  static async query(method, endpoint, label) {
    try {
      return await this.makeRequest(method, endpoint);
    } catch (error) {
      logger.error(`[VAS] ${label} failed [${error.response?.status || error.code || "no status"}]`);
      throw new Error(`${label} failed`);
    }
  }

  // Money-moving call: single attempt, never retried, outcome classified.
  static async purchase(endpoint, payload, reference, label) {
    try {
      const body = await this.makeRequest("post", endpoint, payload, { timeout: 45000 });
      const outcome = classifyResponse(body);
      logger.info(`[VAS] ${label} ${reference}: ${outcome}`);
      return { outcome, providerRef: body?.data?.transactionReference || null, raw: body };
    } catch (error) {
      const outcome = wasRejected(error) ? OUTCOME.FAILED : OUTCOME.UNKNOWN;
      logger.error(`[VAS] ${label} ${reference} error [${error.response?.status || error.code}]: ${outcome}`);
      return { outcome, providerRef: null, raw: error.response?.data ?? { error: error.code || error.message } };
    }
  }

  static async detectNetwork(phoneNumber) {
    const phone = toLocalPhone(phoneNumber);
    const cached = this.networkCache.get(phone);
    if (cached && Date.now() - cached.timestamp < 300000) return cached.data;

    try {
      const response = await this.makeRequest("get", `/topup/network?phone=${encodeURIComponent(phone)}`);
      if (String(response?.status).toLowerCase() === "success" && response.data?.network) {
        const name = response.data.network.toUpperCase();
        const data = { name: name === "ETISALAT" ? "9MOBILE" : name };
        this.networkCache.set(phone, { data, timestamp: Date.now() });
        return data;
      }
    } catch (error) {
      logger.warn(`[VAS] Network detection failed [${error.response?.status || error.code}]`);
    }
    return { name: "UNKNOWN" };
  }

  static async getDataPlans(phoneNumber) {
    try {
      const phone = toLocalPhone(phoneNumber);
      const response = await this.makeRequest("get", `/topup/dataPlans?phone=${encodeURIComponent(phone)}`);
      if (String(response?.status).toLowerCase() !== "success" || !Array.isArray(response.data)) return [];
      return response.data
        .map((plan) => ({
          productId: String(plan.productId || plan.id),
          name: plan.name || plan.productName,
          size: plan.dataVolume || plan.size || plan.name || plan.productName,
          price: Number.parseFloat(plan.amount ?? plan.price),
          validity: plan.validity || "",
        }))
        .filter((p) => p.productId && Number.isFinite(p.price) && p.price > 0);
    } catch (error) {
      logger.warn(`[VAS] Failed to fetch data plans [${error.response?.status || error.code}]`);
      return [];
    }
  }

  static buyAirtime({ reference, phoneNumber, amount, network, debitAccount }) {
    return this.purchase(
      "/topup/airtime",
      { phoneNumber: toLocalPhone(phoneNumber), amount: String(amount), transactionReference: reference, debitAccount, network },
      reference,
      "airtime",
    );
  }

  static buyData({ reference, phoneNumber, productId, amount, network, debitAccount }) {
    return this.purchase(
      "/topup/data",
      { phoneNumber: toLocalPhone(phoneNumber), productId, amount: String(amount), transactionReference: reference, debitAccount, network },
      reference,
      "data",
    );
  }

  static getBillCategories() {
    return this.query("get", "/billspayment/categories", "Bill categories");
  }

  static getCategoryBillers(categoryId) {
    return this.query("get", `/billspayment/billers/${encodeURIComponent(categoryId)}`, "Billers");
  }

  static getBillerFields(billerId) {
    return this.query("get", `/billspayment/fields/${encodeURIComponent(billerId)}`, "Biller fields");
  }

  static async validatePayment(payload) {
    try {
      return await this.makeRequest("post", "/billspayment/validate", payload);
    } catch (error) {
      logger.warn(`[VAS] Bill validation failed [${error.response?.status || error.code}]`);
      return null;
    }
  }

  // Caller fields go first so they can never override the debit account, amount or reference.
  static payBill({ reference, billerId, amount, debitAccount, fields = {} }) {
    return this.purchase(
      "/billspayment/pay",
      { ...fields, billerId, amount: String(amount), accountNumber: debitAccount, transactionReference: reference },
      reference,
      "bill",
    );
  }

  static async getTopupStatus(reference) {
    return this.status(`/topup/status?transReference=${encodeURIComponent(reference)}`, reference);
  }

  static async getBillStatus(reference) {
    return this.status(`/billspayment/status?transReference=${encodeURIComponent(reference)}`, reference);
  }

  static async status(endpoint, reference) {
    try {
      const body = await this.makeRequest("get", endpoint);
      return { outcome: classifyStatusQuery(body), raw: body };
    } catch (error) {
      logger.warn(`[VAS] status ${reference} failed [${error.response?.status || error.code}]`);
      return { outcome: OUTCOME.UNKNOWN, raw: null };
    }
  }
}

export default PsbVasService;
