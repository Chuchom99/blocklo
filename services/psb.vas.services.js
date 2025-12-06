// import axios from "axios";
// import crypto from "crypto";
// import logger from "../config/logger.js";
// import prisma from "../config/prisma.js";
// import { v4 as uuidv4 } from "uuid";

// const PSB_SECRET_KEY = process.env.PSB_SECRET_KEY;
// const PSB_VAS_BASE_URL =
//   process.env.PSB_VAS_BASE_URL || "http://102.216.128.75:9090/vas/api/v1";
// const PSB_IDENTITY_BASE_URL =
//   process.env.PSB_IDENTITY_BASE_URL ||
//   "http://102.216.128.75:9090/identity/api/v1";

// class PsbVasService {
//   /** 🔐 Generate SHA256 HMAC signature */
//   static generateSignature(payload) {
//     const sorted = Object.keys(payload)
//       .sort()
//       .reduce((acc, key) => {
//         acc[key] = payload[key];
//         return acc;
//       }, {});
//     const raw = JSON.stringify(sorted);
//     return crypto
//       .createHmac("sha256", PSB_SECRET_KEY)
//       .update(raw)
//       .digest("hex");
//   }

//   static cachedToken = null;
//   static tokenExpiry = 0;

//   /** 🔑 Get VAS Auth Token (with caching) */

//   static async getVASAuthToken(forceRefresh = false) {
//     try {
//       const now = Date.now();

//       // ✅ Reuse token if still valid
//       if (!forceRefresh && this.cachedToken && now < this.tokenExpiry) {
//         logger.info("[VAS] Using cached token");
//         return this.cachedToken;
//       }

//       logger.info("[VAS] Requesting new authentication token...");

//       const response = await axios.post(
//         `${PSB_IDENTITY_BASE_URL}/authenticate`,
//         {
//           username: process.env.PSB_VAS_API_KEY,
//           password: process.env.PSB_VAS_SECRET_KEY,
//         },
//         { headers: { "Content-Type": "application/json" }, timeout: 15000 }
//       );

//       const data = response.data;

//       if (
//         data?.status?.toLowerCase() !== "success" ||
//         !data?.data?.accessToken
//       ) {
//         throw new Error(
//           `Auth failed: ${data?.message || "Invalid credentials"}`
//         );
//       }

//       // ✅ Cache token for reuse
//       this.cachedToken = data.data.accessToken;
//       this.tokenExpiry = now + (data.data.expiresIn || 7200000);

//       logger.info("[VAS] Token retrieved successfully");
//       return this.cachedToken;
//     } catch (error) {
//       logger.error(`[VAS] Auth Token Error: ${error.message}`);
//       throw new Error("Failed to authenticate with VAS API");
//     }
//   }

//   /** 🌍 Generic API Request Handler with logging and error management */
//   static async makeRequest(method, url, token, payload = null) {
//     try {
//       const headers = {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${token}`,
//       };

//       logger.info(`[VAS] Request → ${method.toUpperCase()} ${url}`);

//       const response = await axios({
//         method,
//         url,
//         headers,
//         data: payload,
//         timeout: 20000,
//       });

//       const data = response.data;
//       logger.info(
//         `[VAS] Response (${url}): ${JSON.stringify(data).slice(0, 250)}...`
//       );

//       if (!data || data.status?.toUpperCase() !== "SUCCESS") {
//         throw new Error(data?.message || "VAS request failed");
//       }

//       return data;
//     } catch (error) {
//       logger.error(`[VAS] Request Error (${url}): ${error.message}`);
//       throw new Error(`VAS request failed: ${error.message}`);
//     }
//   }

//   /** 🔌 Get Network by phone number */
//   static async getNetwork(phoneNumber) {
//     const token = await this.getVASAuthToken();
//     const url = `${PSB_VAS_BASE_URL}/topup/network?phone=${phoneNumber}`;
//     return this.makeRequest("get", url, token);
//   }

//   /** 📶 Get Data Plans */
//   static async getDataPlans(phoneNumber) {
//     const token = await this.getVASAuthToken();
//     const url = `${PSB_VAS_BASE_URL}/topup/dataPlans?phone=${phoneNumber}`;
//     return this.makeRequest("get", url, token);
//   }

//   /** 💵 Buy Airtime */
// static async buyAirtime({ userId, accountId, phoneNumber, amount }) {
//   const token = await this.getVASAuthToken();

//   const account = await prisma.account.findUnique({
//     where: { id: accountId },
//   });
//   if (!account) throw new Error("Account not found");

//   const numericAmount = parseFloat(amount);
//   // if (account.balance < numericAmount)
//   //   throw new Error("Insufficient balance");

//   const transactionReference = uuidv4().replace(/-/g, "").slice(0, 18);

//   const payload = {
//     phoneNumber,
//     amount: String(numericAmount), // ✅ PSB expects string
//     transactionReference,
//     debitAccount: account.accountNumber, // ✅ required for PSB
//     network: this.getNetwork(phoneNumber), // ✅ required field
//   };
//   logger.info(`[VAS] Detected network: ${network} for ${phoneNumber}`);

//   const transaction = await prisma.transaction.create({
//     data: {
//       userId,
//       accountId,
//       amount: numericAmount, // ✅ Prisma expects float
//       reference: transactionReference,
//       type: "DEBIT",
//       status: "PENDING",
//     },
//   });

//   try {
//     const response = await this.makeRequest(
//       "post",
//       `${PSB_VAS_BASE_URL}/topup/airtime`,
//       token,
//       payload
//     );

//     await prisma.$transaction([
//       prisma.account.update({
//         where: { id: accountId },
//         data: { balance: account.balance - numericAmount },
//       }),
//       prisma.transaction.update({
//         where: { id: transaction.id },
//         data: { status: "SUCCESS", metadata: response.data || {} },
//       }),
//     ]);

//     logger.info(`[VAS] Airtime purchase successful for ${phoneNumber}`);
//     return response;
//   } catch (error) {
//     await prisma.transaction.update({
//       where: { id: transaction.id },
//       data: { status: "FAILED", metadata: { error: error.message } },
//     });
//     logger.error(`[VAS] Airtime purchase failed: ${error.message}`);
//     throw error;
//   }
// }

//   /** 🌐 Buy Data */
// static async buyData({ userId, accountId, phoneNumber, productId, amount }) {
//   const token = await this.getVASAuthToken();

//   const amountValue = parseFloat(amount);
//   if (isNaN(amountValue) || amountValue <= 0) {
//     throw new Error("Invalid amount value");
//   }

//   // 🧾 Find debit account
//   const account = await prisma.account.findUnique({ where: { id: accountId } });
//   if (!account) throw new Error("Account not found");
//   // if (account.balance < amountValue) throw new Error("Insufficient balance");

//   const transactionReference = uuidv4().replace(/-/g, "").slice(0, 18);

//   // ✅ Determine network automatically (based on phone number prefix)
//   const network = this.getNetwork(phoneNumber);

//   // ✅ Proper payload structure for PSB
//   const payload = {
//     network,                          // e.g. "MTN"
//     debitAccount: account.accountNumber, // your 9PSB wallet
//     phoneNumber,
//     productId,                         // from your payload
//     amount: String(amount),
//     transactionReference,
//   };

//   const transaction = await prisma.transaction.create({
//     data: {
//       userId,
//       accountId,
//       amount: amountValue,
//       reference: transactionReference,
//       type: "DEBIT",
//       status: "PENDING",
//     },
//   });

//   try {
//     const response = await this.makeRequest(
//       "post",
//       `${PSB_VAS_BASE_URL}/topup/data`,
//       token,
//       payload
//     );

//     await prisma.$transaction([
//       prisma.account.update({
//         where: { id: accountId },
//         data: { balance: account.balance - amountValue },
//       }),
//       prisma.transaction.update({
//         where: { id: transaction.id },
//         data: {
//           status: "SUCCESS",
//           metadata: response.data || {},
//         },
//       }),
//     ]);

//     logger.info(`[VAS] Data purchase successful for ${phoneNumber}`);
//     return response;
//   } catch (error) {
//     await prisma.transaction.update({
//       where: { id: transaction.id },
//       data: { status: "FAILED", metadata: { error: error.message } },
//     });

//     logger.error(`[VAS] Data purchase failed: ${error.message}`);
//     throw error;
//   }
// }

// /** 🔍 Simple network detector */

//   /** ⚡ Get Bill Categories */
//   static async getBillCategories() {
//     const token = await this.getVASAuthToken();
//     const url = `${PSB_VAS_BASE_URL}/billspayment/categories`;
//     return this.makeRequest("get", url, token);
//   }

//   /** 🏢 Get Billers under a Category */
//   static async getCategoryBillers(categoryId) {
//     const token = await this.getVASAuthToken();
//     const url = `${PSB_VAS_BASE_URL}/billspayment/billers/${categoryId}`;
//     return this.makeRequest("get", url, token);
//   }

//   /** 📋 Get Input Fields for a Biller */
//   static async getBillerFields(billerId) {
//     const token = await this.getVASAuthToken();
//     const url = `${PSB_VAS_BASE_URL}/billspayment/fields/${billerId}`;
//     return this.makeRequest("get", url, token);
//   }

//   /** ✅ Validate Biller Inputs */
//   static async validateBillerInputs(payload) {
//     const token = await this.getVASAuthToken();
//     const url = `${PSB_VAS_BASE_URL}/billspayment/validate`;
//     return this.makeRequest("post", url, token, payload);
//   }

//   /** 💰 Pay Bill (with transaction save + balance update) */
//   static async payBill({ userId, accountId, billerId, amount, fields }) {
//     const token = await this.getVASAuthToken();
//     let account;

//     if (accountId) {
//       account = await prisma.account.findUnique({ where: { id: accountId } });
//     } else if (fields?.debitAccount) {
//       account = await prisma.account.findUnique({
//         where: { accountNumber: fields.debitAccount },
//       });
//     } else {
//       throw new Error("Missing accountId or debitAccount in request payload");
//     }

//     if (!account) throw new Error("Account not found");

//     // ✅ Convert string to number for DB storage
//     const numericAmount = parseFloat(amount);
//     if (isNaN(numericAmount)) throw new Error("Invalid amount format");

//     // if (account.balance < numericAmount)
//     //   throw new Error("Insufficient balance");

//     const transactionReference = uuidv4().replace(/-/g, "").slice(0, 18);

//     // ✅ Convert back to string only for PSB request
//     const payload = {
//       billerId,
//       amount: String(amount), // PSB requires string
//       accountNumber: account.accountNumber,
//       transactionReference,
//       ...fields,
//     };

//     // ✅ Save as float to DB
//     const transaction = await prisma.transaction.create({
//       data: {
//         userId,
//         accountId: account.id,
//         amount: numericAmount, // Prisma requires Float
//         reference: transactionReference,
//         type: "DEBIT",
//         status: "PENDING",
//       },
//     });

//     try {
//       const response = await this.makeRequest(
//         "post",
//         `${PSB_VAS_BASE_URL}/billspayment/pay`,
//         token,
//         payload
//       );

//       await prisma.$transaction([
//         prisma.account.update({
//           where: { id: account.id },
//           data: { balance: account.balance - numericAmount },
//         }),
//         prisma.transaction.update({
//           where: { id: transaction.id },
//           data: {
//             status: "SUCCESS",
//             metadata: response.data || {},
//           },
//         }),
//       ]);

//       logger.info(`[VAS] Bill payment successful for ${account.accountNumber}`);
//       return response;
//     } catch (error) {
//       await prisma.transaction.update({
//         where: { id: transaction.id },
//         data: { status: "FAILED", metadata: { error: error.message } },
//       });

//       logger.error(`[VAS] Bill payment failed: ${error.message}`);
//       throw error;
//     }
//   }

//   /** 📊 Get Bill Payment Status */
//   static async getBillStatus(transactionReference) {
//     try {
//       const token = await this.getVASAuthToken();
//       const url = `${PSB_VAS_BASE_URL}/billspayment/status?transRef=${transactionReference}`;
//       const response = await this.makeRequest("get", url, token);

//       return response;
//     } catch (error) {
//       if (/Unexpected Error Occured/i.test(error.message)) {
//         throw new Error(
//           "Transaction not found or still processing on PSB’s system. Please retry later."
//         );
//       }
//       throw new Error(`Failed to fetch bill status: ${error.message}`);
//     }
//   }
// }

// export default PsbVasService;

// services/psb.vas.service.js
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
  static cachedToken = null;
  static tokenExpiry = 0;

  /** Get VAS Auth Token (cached) */
  static async getVASAuthToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedToken && now < this.tokenExpiry) {
      return this.cachedToken;
    }

    try {
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
        throw new Error(data?.message || "VAS Auth failed");
      }

      this.cachedToken = data.data.accessToken;
      this.tokenExpiry = now + (data.data.expiresIn || 7200000); // 2 hours default
      logger.info("[VAS] New token acquired");
      return this.cachedToken;
    } catch (error) {
      logger.error(`[VAS] Token fetch failed: ${error.message}`);
      throw new Error("VAS authentication failed");
    }
  }

  /** Generic Request with Full Logging */
  static async makeRequest(method, endpoint, payload = null) {
    const token = await this.getVASAuthToken();
    const url = `${PSB_VAS_BASE_URL}${endpoint}`;

    logger.info(`[VAS] → ${method.toUpperCase()} ${endpoint}`);
    if (payload) logger.info(`[VAS] Payload: ${JSON.stringify(payload)}`);

    try {
      const response = await axios({
        method,
        url,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        data: payload,
        timeout: 25000,
      });

      logger.info(
        `[VAS] ← Success: ${JSON.stringify(response.data).slice(0, 500)}`
      );
      return response.data;
    } catch (error) {
      const errMsg = error.response?.data || error.message;
      logger.error(`[VAS] ← FAILED ${endpoint}: ${JSON.stringify(errMsg)}`);
      throw new Error(
        `VAS Error: ${errMsg.message || errMsg || error.message}`
      );
    }
  }

  // In PsbVasService class

  static networkCache = new Map(); // Simple in-memory cache

  static async detectNetwork(phoneNumber) {
    // Remove +234 or 0 prefix if needed
    const cleanPhone = phoneNumber.replace(/^(\+234|234|0)/, "0");

    // Check cache first (5-minute TTL)
    const cached = this.networkCache.get(cleanPhone);
    if (cached && Date.now() - cached.timestamp < 300000) {
      return cached.data;
    }

    try {
      const response = await this.makeRequest(
        "get",
        `/topup/network?phone=${cleanPhone}`
      );

      if (
        response.status?.toLowerCase() === "success" &&
        response.data?.network
      ) {
        const networkData = {
          name: response.data.network.toUpperCase(),
          emoji:
            {
              MTN: "MTN",
              AIRTEL: "Airtel",
              GLO: "Glo",
              "9MOBILE": "9mobile",
              ETISALAT: "9mobile",
            }[response.data.network.toUpperCase()] || "Phone",
        };

        // Cache for 5 minutes
        this.networkCache.set(cleanPhone, {
          data: networkData,
          timestamp: Date.now(),
        });

        return networkData;
      }

      return { name: "Unknown", emoji: "Question" };
    } catch (error) {
      logger.warn(
        `[VAS] Network detection failed for ${cleanPhone}: ${error.message}`
      );
      return { name: "Unknown", emoji: "Question" };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // AIRTIME
  // ─────────────────────────────────────────────────────────────
  static async buyAirtime({ userId, accountId, phoneNumber, amount }) {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new Error("Account not found");

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 50)
      throw new Error("Minimum airtime: ₦50");

    const ref = uuidv4().replace(/-/g, "").slice(0, 18);
    const networkInfo = await this.detectNetwork(phoneNumber);
    const network = networkInfo.name;

    const payload = {
      phoneNumber,
      amount: String(amountNum),
      transactionReference: ref,
      debitAccount: account.accountNumber,
      network,
    };

    const transaction = await prisma.transaction.create({
      data: {
        userId,
        accountId,
        amount: amountNum,
        reference: ref,
        type: "DEBIT",
        status: "PENDING",
        description: `Airtime: ${phoneNumber}`,
      },
    });

    try {
      const response = await this.makeRequest(
        "post",
        "/topup/airtime",
        payload
      );

      // ONLY update Transaction with metadata
      await prisma.$transaction([
        // Remove metadata from account update
        prisma.account.update({
          where: { id: accountId },
          data: {
            // Only update balance if you have it in Account model
            // balance: { decrement: amountNum }
          },
        }),
        prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            status: "SUCCESS",
            metadata: response,
          },
        }),
      ]);

      return { success: true, data: response, ref };
    } catch (error) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: "FAILED",
          metadata: { error: error.message, psbResponse: error.response?.data },
        },
      });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // DATA
  // ─────────────────────────────────────────────────────────────
  static async getDataPlans(phoneNumber) {
    try {
      const cleanPhone = phoneNumber.replace(/^(\+234|234)/, "0");
      const response = await this.makeRequest(
        "get",
        `/topup/dataPlans?phone=${cleanPhone}`
      );

      if (
        response.status?.toLowerCase() === "success" &&
        Array.isArray(response.data)
      ) {
        return response.data.map((plan) => ({
          productId: plan.productId || plan.id,
          name: plan.name || plan.productName,
          size: plan.dataVolume || plan.size,
          price: parseFloat(plan.amount || plan.price),
          validity: plan.validity || "30 days",
          network: plan.network || "Unknown",
        }));
      }
      return [];
    } catch (error) {
      logger.warn(`[VAS] Failed to fetch data plans: ${error.message}`);
      return [];
    }
  }

  static async buyData({ userId, accountId, phoneNumber, productId, amount }) {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new Error("Account not found");

    const amountNum = parseFloat(amount);
    const ref = uuidv4().replace(/-/g, "").slice(0, 18);
    const networkInfo = await this.detectNetwork(phoneNumber);
    const network = networkInfo.name;

    const payload = {
      phoneNumber,
      productId,
      amount: String(amountNum),
      transactionReference: ref,
      debitAccount: account.accountNumber,
      network,
    };

    const transaction = await prisma.transaction.create({
      data: {
        userId,
        accountId,
        amount: amountNum,
        reference: ref,
        type: "DEBIT",
        status: "PENDING",
        description: `Data: ${phoneNumber}`,
      },
    });

    try {
      const response = await this.makeRequest("post", "/topup/data", payload);

      await prisma.$transaction([
        // Remove metadata from account update
        prisma.account.update({
          where: { id: accountId },
          data: {
            // Only update balance if you have it in Account model
            // balance: { decrement: amountNum }
          },
        }),
        prisma.transaction.update({
          where: { id: transaction.id },
          data: {
            status: "SUCCESS",
            metadata: response,
          },
        }),
      ]);

      return { success: true, data: response, ref };
    } catch (error) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: "FAILED", metadata: { error: error.message } },
      });
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // BILLS
  // ─────────────────────────────────────────────────────────────
  static async getBillCategories() {
    return await this.makeRequest("get", "/billspayment/categories");
  }

  static async getBillers(categoryId) {
    return await this.makeRequest("get", `/billspayment/billers/${categoryId}`);
  }

  static async getBillerFields(billerId) {
    return await this.makeRequest("get", `/billspayment/fields/${billerId}`);
  }

  static async validatePayment(payload) {
    return await this.makeRequest("post", "/billspayment/validate", payload);
  }

  static async payBill({ userId, accountId, billerId, amount, fields }) {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new Error("Account not found");

    const amountNum = parseFloat(amount);
    const ref = uuidv4().replace(/-/g, "").slice(0, 18);

    const payload = {
      billerId,
      amount: String(amountNum),
      accountNumber: account.accountNumber,
      transactionReference: ref,
      ...fields,
    };

    const transaction = await prisma.transaction.create({
      data: {
        userId,
        accountId,
        amount: amountNum,
        reference: ref,
        type: "DEBIT",
        status: "PENDING",
        description: `Bill: ${fields.customerId || billerId}`,
      },
    });

    try {
      const response = await this.makeRequest(
        "post",
        "/billspayment/pay",
        payload
      );

      await prisma.$transaction([
        prisma.account.update({
          where: { id: accountId },
          data: { status: "SUCCESS", metadata: response },
        }),
        prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: "SUCCESS", metadata: response },
        }),
      ]);

      return { success: true, data: response, ref };
    } catch (error) {
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: "FAILED", metadata: { error: error.message } },
      });
      throw error;
    }
  }
}

export default PsbVasService;
