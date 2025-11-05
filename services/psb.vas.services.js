import axios from "axios";
import crypto from "crypto";
import logger from "../config/logger.js";
import prisma from "../config/prisma.js";
import { v4 as uuidv4 } from "uuid";

const PSB_SECRET_KEY = process.env.PSB_SECRET_KEY;
const PSB_VAS_BASE_URL =
  process.env.PSB_VAS_BASE_URL || "http://102.216.128.75:9090/vas/api/v1";
const PSB_IDENTITY_BASE_URL =
  process.env.PSB_IDENTITY_BASE_URL ||
  "http://102.216.128.75:9090/identity/api/v1";

class PsbVasService {
  /** 🔐 Generate SHA256 HMAC signature */
  static generateSignature(payload) {
    const sorted = Object.keys(payload)
      .sort()
      .reduce((acc, key) => {
        acc[key] = payload[key];
        return acc;
      }, {});
    const raw = JSON.stringify(sorted);
    return crypto
      .createHmac("sha256", PSB_SECRET_KEY)
      .update(raw)
      .digest("hex");
  }

  static cachedToken = null;
  static tokenExpiry = 0;

  /** 🔑 Get VAS Auth Token (with caching) */

  static async getVASAuthToken(forceRefresh = false) {
    try {
      const now = Date.now();

      // ✅ Reuse token if still valid
      if (!forceRefresh && this.cachedToken && now < this.tokenExpiry) {
        logger.info("[VAS] Using cached token");
        return this.cachedToken;
      }

      logger.info("[VAS] Requesting new authentication token...");

      const response = await axios.post(
        `${PSB_IDENTITY_BASE_URL}/authenticate`,
        {
          username: process.env.PSB_VAS_API_KEY,
          password: process.env.PSB_VAS_SECRET_KEY,
        },
        { headers: { "Content-Type": "application/json" }, timeout: 15000 }
      );

      const data = response.data;

      if (
        data?.status?.toLowerCase() !== "success" ||
        !data?.data?.accessToken
      ) {
        throw new Error(
          `Auth failed: ${data?.message || "Invalid credentials"}`
        );
      }

      // ✅ Cache token for reuse
      this.cachedToken = data.data.accessToken;
      this.tokenExpiry = now + (data.data.expiresIn || 7200000);

      logger.info("[VAS] Token retrieved successfully");
      return this.cachedToken;
    } catch (error) {
      logger.error(`[VAS] Auth Token Error: ${error.message}`);
      throw new Error("Failed to authenticate with VAS API");
    }
  }

  /** 🌍 Generic API Request Handler with logging and error management */
  static async makeRequest(method, url, token, payload = null) {
    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      logger.info(`[VAS] Request → ${method.toUpperCase()} ${url}`);

      const response = await axios({
        method,
        url,
        headers,
        data: payload,
        timeout: 20000,
      });

      const data = response.data;
      logger.info(
        `[VAS] Response (${url}): ${JSON.stringify(data).slice(0, 250)}...`
      );

      if (!data || data.status?.toUpperCase() !== "SUCCESS") {
        throw new Error(data?.message || "VAS request failed");
      }

      return data;
    } catch (error) {
      logger.error(`[VAS] Request Error (${url}): ${error.message}`);
      throw new Error(`VAS request failed: ${error.message}`);
    }
  }

  /** 🔌 Get Network by phone number */
  static async getNetwork(phoneNumber) {
    const token = await this.getVASAuthToken();
    const url = `${PSB_VAS_BASE_URL}/topup/network?phone=${phoneNumber}`;
    return this.makeRequest("get", url, token);
  }

  /** 📶 Get Data Plans */
  static async getDataPlans(phoneNumber) {
    const token = await this.getVASAuthToken();
    const url = `${PSB_VAS_BASE_URL}/topup/dataPlans?phone=${phoneNumber}`;
    return this.makeRequest("get", url, token);
  }

  /** 💵 Buy Airtime */
static async buyAirtime({ userId, accountId, phoneNumber, amount }) {
  const token = await this.getVASAuthToken();

  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });
  if (!account) throw new Error("Account not found");

  const numericAmount = parseFloat(amount);
  if (account.balance < numericAmount)
    throw new Error("Insufficient balance");

  const transactionReference = uuidv4().replace(/-/g, "").slice(0, 18);

  const payload = {
    phoneNumber,
    amount: String(numericAmount), // ✅ PSB expects string
    transactionReference,
    debitAccount: account.accountNumber, // ✅ required for PSB
    network: this.detectNetwork(phoneNumber), // ✅ required field
  };

  const transaction = await prisma.transaction.create({
    data: {
      userId,
      accountId,
      amount: numericAmount, // ✅ Prisma expects float
      reference: transactionReference,
      type: "DEBIT",
      status: "PENDING",
    },
  });

  try {
    const response = await this.makeRequest(
      "post",
      `${PSB_VAS_BASE_URL}/topup/airtime`,
      token,
      payload
    );

    await prisma.$transaction([
      prisma.account.update({
        where: { id: accountId },
        data: { balance: account.balance - numericAmount },
      }),
      prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: "SUCCESS", metadata: response.data || {} },
      }),
    ]);

    logger.info(`[VAS] Airtime purchase successful for ${phoneNumber}`);
    return response;
  } catch (error) {
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: "FAILED", metadata: { error: error.message } },
    });
    logger.error(`[VAS] Airtime purchase failed: ${error.message}`);
    throw error;
  }
}


  /** 🌐 Buy Data */
static async buyData({ userId, accountId, phoneNumber, productId, amount }) {
  const token = await this.getVASAuthToken();

  const amountValue = parseFloat(amount);
  if (isNaN(amountValue) || amountValue <= 0) {
    throw new Error("Invalid amount value");
  }

  // 🧾 Find debit account
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error("Account not found");
  if (account.balance < amountValue) throw new Error("Insufficient balance");

  const transactionReference = uuidv4().replace(/-/g, "").slice(0, 18);

  // ✅ Determine network automatically (based on phone number prefix)
  const network = this.detectNetwork(phoneNumber);

  // ✅ Proper payload structure for PSB
  const payload = {
    network,                          // e.g. "MTN"
    debitAccount: account.accountNumber, // your 9PSB wallet
    phoneNumber,
    productId,                         // from your payload
    amount: String(amount),
    transactionReference,
  };

  const transaction = await prisma.transaction.create({
    data: {
      userId,
      accountId,
      amount: amountValue,
      reference: transactionReference,
      type: "DEBIT",
      status: "PENDING",
    },
  });

  try {
    const response = await this.makeRequest(
      "post",
      `${PSB_VAS_BASE_URL}/topup/data`,
      token,
      payload
    );

    await prisma.$transaction([
      prisma.account.update({
        where: { id: accountId },
        data: { balance: account.balance - amountValue },
      }),
      prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: "SUCCESS",
          metadata: response.data || {},
        },
      }),
    ]);

    logger.info(`[VAS] Data purchase successful for ${phoneNumber}`);
    return response;
  } catch (error) {
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: "FAILED", metadata: { error: error.message } },
    });

    logger.error(`[VAS] Data purchase failed: ${error.message}`);
    throw error;
  }
}

/** 🔍 Simple network detector */
static detectNetwork(phone) {
  if (!phone) return "UNKNOWN";
  const prefix = phone.replace(/^(\+234|234|0)/, "0").slice(0, 4);
  if (["0803", "0806", "0703", "0706", "0813", "0810", "0814", "0816", "0903", "0906", "0913"].includes(prefix)) return "MTN";
  if (["0805", "0807", "0705", "0815", "0811", "0905", "0915"].includes(prefix)) return "GLO";
  if (["0802", "0808", "0701", "0708", "0812", "0902", "0907", "0901", "0912"].includes(prefix)) return "AIRTEL";
  if (["0809", "0817", "0818", "0908", "0909"].includes(prefix)) return "9MOBILE";
  return "UNKNOWN";
}


  /** ⚡ Get Bill Categories */
  static async getBillCategories() {
    const token = await this.getVASAuthToken();
    const url = `${PSB_VAS_BASE_URL}/billspayment/categories`;
    return this.makeRequest("get", url, token);
  }

  /** 🏢 Get Billers under a Category */
  static async getCategoryBillers(categoryId) {
    const token = await this.getVASAuthToken();
    const url = `${PSB_VAS_BASE_URL}/billspayment/billers/${categoryId}`;
    return this.makeRequest("get", url, token);
  }

  /** 📋 Get Input Fields for a Biller */
  static async getBillerFields(billerId) {
    const token = await this.getVASAuthToken();
    const url = `${PSB_VAS_BASE_URL}/billspayment/fields/${billerId}`;
    return this.makeRequest("get", url, token);
  }

  /** ✅ Validate Biller Inputs */
  static async validateBillerInputs(payload) {
    const token = await this.getVASAuthToken();
    const url = `${PSB_VAS_BASE_URL}/billspayment/validate`;
    return this.makeRequest("post", url, token, payload);
  }

  /** 💰 Pay Bill (with transaction save + balance update) */
  static async payBill({ userId, accountId, billerId, amount, fields }) {
    const token = await this.getVASAuthToken();
    let account;

    if (accountId) {
      account = await prisma.account.findUnique({ where: { id: accountId } });
    } else if (fields?.debitAccount) {
      account = await prisma.account.findUnique({
        where: { accountNumber: fields.debitAccount },
      });
    } else {
      throw new Error("Missing accountId or debitAccount in request payload");
    }

    if (!account) throw new Error("Account not found");

    // ✅ Convert string to number for DB storage
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount)) throw new Error("Invalid amount format");

    if (account.balance < numericAmount)
      throw new Error("Insufficient balance");

    const transactionReference = uuidv4().replace(/-/g, "").slice(0, 18);

    // ✅ Convert back to string only for PSB request
    const payload = {
      billerId,
      amount: String(amount), // PSB requires string
      accountNumber: account.accountNumber,
      transactionReference,
      ...fields,
    };

    // ✅ Save as float to DB
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        accountId: account.id,
        amount: numericAmount, // Prisma requires Float
        reference: transactionReference,
        type: "DEBIT",
        status: "PENDING",
      },
    });

    try {
      const response = await this.makeRequest(
        "post",
        `${PSB_VAS_BASE_URL}/billspayment/pay`,
        token,
        payload
      );

      await prisma.$transaction([
        prisma.account.update({
          where: { id: account.id },
          data: { balance: account.balance - numericAmount },
        }),
        prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            status: "SUCCESS",
            metadata: response.data || {},
          },
        }),
      ]);

      logger.info(`[VAS] Bill payment successful for ${account.accountNumber}`);
      return response;
    } catch (error) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: "FAILED", metadata: { error: error.message } },
      });

      logger.error(`[VAS] Bill payment failed: ${error.message}`);
      throw error;
    }
  }

  /** 📊 Get Bill Payment Status */
  static async getBillStatus(transactionReference) {
    try {
      const token = await this.getVASAuthToken();
      const url = `${PSB_VAS_BASE_URL}/billspayment/status?transRef=${transactionReference}`;
      const response = await this.makeRequest("get", url, token);

      return response;
    } catch (error) {
      if (/Unexpected Error Occured/i.test(error.message)) {
        throw new Error(
          "Transaction not found or still processing on PSB’s system. Please retry later."
        );
      }
      throw new Error(`Failed to fetch bill status: ${error.message}`);
    }
  }
}

export default PsbVasService;
