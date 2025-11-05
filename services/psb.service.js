import axios from "axios";
import crypto from "crypto";
import logger from "../config/logger.js";
import prisma from "../config/prisma.js";
import { v4 as uuidv4 } from "uuid";

const PSB_BASE_URL =
  process.env.PSB_BASE_URL || "http://102.216.128.75:9090/waas/api/v1";

class PsbService {
  // Generate HMAC-SHA256 signature for VAS authentication

  static generateSignature(payload, secretKey) {
    const sortedPayload = Object.keys(payload)
      .sort()
      .reduce((acc, key) => {
        acc[key] = payload[key];
        return acc;
      }, {});

    const data = JSON.stringify(sortedPayload);
    logger.debug(`Signature payload: ${data}`); // ← Remove in prod
    return crypto.createHmac("sha256", secretKey).update(data).digest("hex");
  }

  // Get OAuth2 token for WAAS (if needed for some endpoints)
  static async getWAASAuthToken() {
    try {
      const response = await axios.post(
        `${PSB_BASE_URL}/authenticate`,
        {
          username: process.env.PSB_WAAS_USERNAME,
          password: process.env.PSB_WAAS_PASSWORD,
          clientId: process.env.PSB_WAAS_CLIENT_ID,
          clientSecret: process.env.PSB_WAAS_CLIENT_SECRET,
        },
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      return response.data.accessToken;
    } catch (error) {
      logger.error(`Error getting WAAS token: ${error.message}`);
      throw new Error(`Failed to get WAAS token: ${error.message}`);
    }
  }

  static async createWallet(user) {
    try {
      // 1️⃣ Get WAAS Access Token
      const token = await this.getWAASAuthToken();
      if (!token) throw new Error("Failed to obtain WAAS access token");

      // 2️⃣ Destructure user object including BVN/NIN
      const {
        firstName,
        lastName,
        accountName,
        email,
        phone,
        gender,
        dateOfBirth,
        address,
        placeOfBirth,
        ninUserId,
        nin,
        bvn,
        nextOfKinName,
        nextOfKinPhone,
        referralName,
        referralPhone,
        otherNames,
      } = user;

      if (!nin && !bvn) {
        throw new Error("At least one of BVN or NIN is required by 9PSB");
      }

      const payload = {
        transactionTrackingRef: uuidv4(),
        lastName,
        otherNames: otherNames || firstName,
        accountName: `${firstName} ${lastName}`,
        phoneNo: phone,
        gender: gender ?? 0,
        dateOfBirth: dateOfBirth || "01/01/1990",
        address: address || "No address provided",
        placeOfBirth: placeOfBirth || "Nigeria",
        // Conditionally include to avoid null
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

      logger.debug(
        `🧾 9PSB wallet payload: ${JSON.stringify(payload, null, 2)}`
      );

      // 3️⃣ Send request
      const response = await axios.post(
        `${PSB_BASE_URL}/open_wallet`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 15000,
        }
      );

      const data = response.data;

      if (!data) throw new Error("Empty response from 9PSB");
      if (data.status?.toLowerCase() !== "success") {
        throw new Error(
          `9PSB wallet creation failed: ${data.message || "Unknown error"}`
        );
      }

      const wallet = data.data || {};
      if (!wallet.accountNumber)
        throw new Error("No account number returned from 9PSB");

      logger.info(
        `✅ 9PSB wallet created for ${email}: ${wallet.accountNumber}`
      );

      return {
        accountNumber: wallet.accountNumber,
        accountName: wallet.accountName || `${firstName} ${lastName}`,
        currency: wallet.currency || "NGN",
        provider: "9PSB",
        message: data.message || "Wallet created successfully",
      };
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `❌ Error creating 9PSB wallet [${
          status || "no status"
        }]: ${JSON.stringify(detail)}`
      );
      throw new Error(`Error creating 9PSB wallet: ${error.message}`);
    }
  }

  // Add this method inside PsbService class
  static async walletEnquiry(accountNo) {
    try {
      // 1️⃣ Get WAAS token
      const token = await this.getWAASAuthToken();
      if (!token) throw new Error("Failed to obtain WAAS token");

      // 2️⃣ Construct payload
      const payload = {
        accountNo,
      };

      // 3️⃣ Send request with Bearer token
      const response = await axios.post(
        `${PSB_BASE_URL}/wallet_enquiry`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 10000,
        }
      );

      const data = response.data;
      if (!data) throw new Error("Empty response from 9PSB");

      if (data.status?.toLowerCase() !== "success") {
        throw new Error(
          `Wallet enquiry failed: ${data.message || "Unknown error"}`
        );
      }

      logger.info(`Wallet enquiry successful for ${accountNo}`);
      return data.data; // returns wallet details including balance
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `Error performing wallet enquiry for ${accountNo} [${
          status || "no status"
        }]: ${JSON.stringify(detail)}`
      );
      throw new Error(`Wallet enquiry failed: ${error.message}`);
    }
  }

  /**
   * Transfer funds between Wallet and Client Float Account
   * @param {string} accountNo Wallet account number
   * @param {string|number} totalAmount Amount to debit/credit
   * @param {string} narration Transaction description
   * @param {Object} merchant { isFee: Boolean, merchantFeeAmount?: string, merchantFeeAccount?: string }
   * @param {"debit"|"credit"} type Type of transaction
   */
  static async singleWalletTransfer(
  accountNo,
  totalAmount,
  narration,
  merchant,
  type = "debit"
) {
  try {
    if (!accountNo || !totalAmount || !narration || !merchant)
      throw new Error("Missing required fields for wallet transfer");

    const transactionId = uuidv4().replace(/-/g, "").substring(0, 25);
    const merchantPayload = {
      isFee: merchant.isFee,
      merchantFeeAmount: merchant.merchantFeeAmount || "0",
      merchantFeeAccount: merchant.merchantFeeAccount || "0000000000",
    };

    const payload = {
      accountNo,
      totalAmount: String(totalAmount),
      transactionId,
      narration,
      merchant: merchantPayload,
    };

    const url =
      type.toLowerCase() === "debit"
        ? `${PSB_BASE_URL}/debit/transfer`
        : `${PSB_BASE_URL}/credit/transfer`;

    let result;
    try {
      // 1️⃣ Try WAAS
      const token = await this.getWAASAuthToken();
      logger.info(
        `Initiating ${type.toUpperCase()} transfer [WAAS] → ${JSON.stringify(payload)}`
      );

      const response = await axios.post(url, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 40000,
      });

      result = response.data;
    } catch (waasError) {
      logger.warn(`WAAS ${type} transfer failed → ${waasError.message}`);

      // 2️⃣ Retry using VAS
      const signature = this.generateSignature(
        payload,
        process.env.PSB_VAS_SECRET_KEY
      );

      logger.info(`Retrying ${type.toUpperCase()} transfer [VAS]`);
      const vasResponse = await axios.post(url, payload, {
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
          apiKey: process.env.PSB_VAS_API_KEY,
        },
        timeout: 40000,
      });

      result = vasResponse.data;
    }

    logger.info(
      `Wallet ${type} transfer for ${accountNo}: ${result.status} (${result.message})`
    );

    // 🧾 Fetch account and user info
    const account = await prisma.account.findUnique({
      where: { accountNumber: accountNo },
    });
    if (!account) throw new Error(`Account not found: ${accountNo}`);

    const amount = parseFloat(totalAmount);

    // ✅ Check if transaction is successful
    const isSuccess =
      result?.data?.isSuccessful === true ||
      result?.data?.status?.toUpperCase?.() === "SUCCESS" ||
      result?.data?.responseCode === "00";

    const transactionStatus = isSuccess ? "SUCCESS" : "FAILED";

    // 💾 Store transaction and update balance
    await prisma.$transaction(async (tx) => {
      // Always record the transaction with correct status
      await tx.transaction.create({
        data: {
          userId: account.userId,
          accountId: account.id,
          amount,
          type: type.toUpperCase(),
          reference: transactionId,
          status: transactionStatus, // 👈 Add this column to schema if not yet present
          metadata: result.data ? JSON.stringify(result.data) : null,
        },
      });

      // ✅ Only update balance when success
      if (isSuccess) {
        const newBalance =
          type.toLowerCase() === "debit"
            ? account.balance - amount
            : account.balance + amount;

        await tx.account.update({
          where: { id: account.id },
          data: { balance: newBalance },
        });

        logger.info(
          `💰 Account ${accountNo} balance updated: ₦${account.balance} → ₦${newBalance}`
        );
      } else {
        logger.warn(
          `⚠️ Transaction failed, balance not updated for ${accountNo}`
        );
      }
    });

    // 🎯 Return clear structured response
    return {
      success: isSuccess,
      message: isSuccess
        ? "Wallet transfer successful"
        : result?.data?.message || "Transaction failed",
      data: result?.data,
    };
  } catch (error) {
    const status = error.response?.status;
    const detail = error.response?.data || error.message;
    logger.error(
      `Error performing wallet ${type} transfer for ${accountNo} [${
        status || "no status"
      }]: ${JSON.stringify(detail)}`
    );
    throw new Error(`Wallet ${type} transfer failed: ${error.message}`);
  }
}


  /**
   * Fetch wallet transaction history
   * @param {string} accountNumber
   * @param {string} fromDate YYYY-MM-DD
   * @param {string} toDate YYYY-MM-DD
   * @param {string|number} numberOfItems
   * @returns {Promise<object>}
   */
  static async getTransactionHistory(
    accountNumber,
    fromDate,
    toDate,
    numberOfItems = "50"
  ) {
    try {
      const token = await this.getWAASAuthToken();
      if (!token) throw new Error("Failed to obtain WAAS token");

      const payload = {
        accountNumber,
        fromDate,
        toDate,
        numberOfItems: String(numberOfItems),
      };

      const response = await axios.post(
        `${PSB_BASE_URL}/wallet_transactions`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 15000,
        }
      );

      const data = response.data;
      if (!data) throw new Error("Empty response from 9PSB");
      if (data.status?.toUpperCase() !== "SUCCESS") {
        throw new Error(
          `Transaction history fetch failed: ${data.message || "Unknown error"}`
        );
      }

      logger.info(`Transaction history fetched for ${accountNumber}`);
      return data; // { message, status, data: [...] }
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `Error fetching transaction history for ${accountNumber} [${
          status || "no status"
        }]: ${JSON.stringify(detail)}`
      );
      throw new Error(`Transaction history fetch failed: ${error.message}`);
    }
  }

  /**
   * Requery transaction status (TSQ)
   * @param {string} transactionId
   * @param {number} amount
   * @param {string} transactionType e.g. DEBIT, CREDIT, OTHER_BANKS
   * @param {string} transactionDate YYYY-MM-DD or ISO
   * @param {string} accountNo
   * @returns {Promise<object>}
   */
  static async requeryTransaction(
    transactionId,
    amount,
    transactionType,
    transactionDate,
    accountNo
  ) {
    try {
      const token = await this.getWAASAuthToken();
      if (!token) throw new Error("Failed to obtain WAAS token");

      const payload = {
        transactionId,
        amount: Number(amount),
        transactionType,
        transactionDate,
        accountNo,
      };

      const response = await axios.post(
        `${PSB_BASE_URL}/wallet_requery`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 15000,
        }
      );

      const data = response.data;
      if (!data) throw new Error("Empty response from 9PSB");
      if (data.status?.toUpperCase() !== "SUCCESS") {
        throw new Error(
          `Transaction requery failed: ${data.message || "Unknown error"}`
        );
      }

      logger.info(`Transaction ${transactionId} requery successful`);
      return data;
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `Error requerying transaction ${transactionId} [${
          status || "no status"
        }]: ${JSON.stringify(detail)}`
      );
      throw new Error(`Transaction requery failed: ${error.message}`);
    }
  }

  /**
   * Transfer from wallet to other banks
   * @param {object} params
   * @param {string} params.accountNo Source wallet
   * @param {string|number} params.amount
   * @param {string} params.narration
   * @param {string} params.destinationAccount
   * @param {string} params.destinationBankCode
   * @param {string} [params.destinationName] Optional - for name enquiry fallback
   * @param {object} params.merchant { isFee, merchantFeeAmount?, merchantFeeAccount? }
   * @returns {Promise<object>}
   */
  static async walletToOtherBanks({
    accountNo,
    amount,
    narration,
    destinationAccount,
    destinationBankCode,
    destinationName,
    merchant,
  }) {
    try {
      if (
        !accountNo ||
        !amount ||
        !narration ||
        !destinationAccount ||
        !destinationBankCode ||
        !merchant
      ) {
        throw new Error(
          "Missing required fields for wallet to other banks transfer"
        );
      }

      const transactionRef = uuidv4();
      const orderRef = uuidv4();

      const payload = {
        transaction: { externalreference: transactionRef },
        order: {
          amount: String(amount),
          status: "PENDING",
          currency: "NGN",
          amountpaid: "0",
          orderref: orderRef,
        },
        customer: {
          account: {
            number: accountNo,
            bank: "9PSB",
            type: "WALLET",
          },
        },
        merchant: {
          isFee: merchant.isFee,
          merchantFeeAmount: merchant.merchantFeeAmount || "0",
          merchantFeeAccount: merchant.merchantFeeAccount || "0000000000",
        },
        transactionType: "OTHER_BANKS",
        narration,
        // Additional fields inferred from docs/sample
        beneficiaryAccountNumber: destinationAccount,
        beneficiaryBankCode: destinationBankCode,
        beneficiaryName: destinationName || "",
      };

      const token = await this.getWAASAuthToken();
      const response = await axios.post(
        `${PSB_BASE_URL}/wallet_other_banks`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 40000,
        }
      );

      const data = response.data;
      if (!data) throw new Error("Empty response from 9PSB");
      if (data.status?.toUpperCase() !== "SUCCESS") {
        throw new Error(
          `Wallet to other banks failed: ${
            data.message || data.responseCode || "Unknown error"
          }`
        );
      }

      logger.info(
        `Wallet to other banks transfer initiated: ${transactionRef}`
      );
      return data;
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `Error wallet to other banks [${
          status || "no status"
        }]: ${JSON.stringify(detail)}`
      );
      throw new Error(`Wallet to other banks failed: ${error.message}`);
    }
  }

  /**
   * Name enquiry for other bank account
   * @param {string} accountNumber
   * @param {string} bankCode
   * @returns {Promise<object>} { accountName, ... }
   */
  static async otherBankEnquiry(accountNumber, bankCode) {
    try {
      const token = await this.getWAASAuthToken();
      if (!token) throw new Error("Failed to obtain WAAS token");

      const payload = {
        customer: {
          accountNumber,
          bankCode,
        },
      };

      const response = await axios.post(
        `${PSB_BASE_URL}/other_banks_enquiry`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 10000,
        }
      );

      const data = response.data;
      if (!data) throw new Error("Empty response from 9PSB");
      if (data.status?.toUpperCase() !== "SUCCESS") {
        throw new Error(
          `Other bank enquiry failed: ${data.message || "Unknown error"}`
        );
      }

      logger.info(
        `Other bank enquiry successful for ${accountNumber}@${bankCode}`
      );
      return data.data;
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `Error other bank enquiry [${status || "no status"}]: ${JSON.stringify(
          detail
        )}`
      );
      throw new Error(`Other bank enquiry failed: ${error.message}`);
    }
  }

  /**
   * Get wallet status
   * @param {string} accountNo
   * @returns {Promise<object>}
   */
  static async getWalletStatus(accountNo) {
    try {
      const token = await this.getWAASAuthToken();
      if (!token) throw new Error("Failed to obtain WAAS token");

      const payload = { accountNo };

      const response = await axios.post(
        `${PSB_BASE_URL}/wallet_status`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 10000,
        }
      );

      const data = response.data;
      if (!data) throw new Error("Empty response from 9PSB");
      if (data.status?.toUpperCase() !== "SUCCESS") {
        throw new Error(
          `Wallet status fetch failed: ${data.message || "Unknown error"}`
        );
      }

      return data;
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `Error fetching wallet status [${
          status || "no status"
        }]: ${JSON.stringify(detail)}`
      );
      throw new Error(`Wallet status fetch failed: ${error.message}`);
    }
  }

  /**
   * Change wallet status (ACTIVE/SUSPENDED)
   * @param {string} accountNumber
   * @param {"ACTIVE"|"SUSPENDED"} accountStatus
   * @returns {Promise<object>}
   */
  static async changeWalletStatus(accountNumber, accountStatus) {
    try {
      if (!["ACTIVE", "SUSPENDED"].includes(accountStatus)) {
        throw new Error("Invalid accountStatus. Must be ACTIVE or SUSPENDED");
      }

      const token = await this.getWAASAuthToken();
      if (!token) throw new Error("Failed to obtain WAAS token");

      const payload = { accountNumber, accountStatus };

      const response = await axios.post(
        `${PSB_BASE_URL}/change_wallet_status`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 10000,
        }
      );

      const data = response.data;
      if (!data) throw new Error("Empty response from 9PSB");
      if (data.status?.toUpperCase() !== "SUCCESS") {
        throw new Error(
          `Change wallet status failed: ${
            data.message || data.responseCode || "Unknown error"
          }`
        );
      }

      logger.info(`Wallet ${accountNumber} status changed to ${accountStatus}`);
      return data;
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `Error changing wallet status [${
          status || "no status"
        }]: ${JSON.stringify(detail)}`
      );
      throw new Error(`Change wallet status failed: ${error.message}`);
    }
  }

  /**
   * Get list of banks
   * @returns {Promise<Array<object>>}
   */
  static async getBanks() {
    try {
      const token = await this.getWAASAuthToken();
      if (!token) throw new Error("Failed to obtain WAAS token");

      const response = await axios.get(`${PSB_BASE_URL}/get_banks`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      });

      const data = response.data;
      if (!data) throw new Error("Empty response from 9PSB");
      if (data.status?.toUpperCase() !== "SUCCESS") {
        throw new Error(`Get banks failed: ${data.message || "Unknown error"}`);
      }

      return data.data; // array of banks
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `Error fetching banks [${status || "no status"}]: ${JSON.stringify(
          detail
        )}`
      );
      throw new Error(`Get banks failed: ${error.message}`);
    }
  }

  /**
   * Notification requery (confirm inflow webhook)
   * @param {string} sessionID or externalReference (long format)
   * @param {string} accountNumber
   * @returns {Promise<object>}
   */
  static async notificationRequery(sessionID, accountNumber) {
    try {
      const token = await this.getWAASAuthToken();
      if (!token) throw new Error("Failed to obtain WAAS token");

      const payload = {
        sessionID,
        accountNumber,
      };

      const response = await axios.post(
        `${PSB_BASE_URL}/notification_requery`,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 10000,
        }
      );

      const data = response.data;
      if (!data) throw new Error("Empty response from 9PSB");
      if (data.status?.toUpperCase() !== "SUCCESS") {
        throw new Error(
          `Notification requery failed: ${
            data.message || data.responseCode || "Unknown error"
          }`
        );
      }

      return data;
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `Error notification requery [${
          status || "no status"
        }]: ${JSON.stringify(detail)}`
      );
      throw new Error(`Notification requery failed: ${error.message}`);
    }
  }

  /**
   * Get wallet by BVN
   * @param {string} bvn
   * @returns {Promise<object>}
   */
  static async getWalletByBVN(bvn) {
    try {
      const token = await this.getWAASAuthToken();
      if (!token) throw new Error("Failed to obtain WAAS token");

      const payload = { bvn };

      const response = await axios.post(`${PSB_BASE_URL}/get_wallet`, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      });

      const data = response.data;
      if (!data) throw new Error("Empty response from 9PSB");
      if (data.status?.toUpperCase() !== "SUCCESS") {
        throw new Error(
          `Get wallet by BVN failed: ${data.message || "Unknown error"}`
        );
      }

      return data.data;
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data || error.message;
      logger.error(
        `Error get wallet by BVN [${status || "no status"}]: ${JSON.stringify(
          detail
        )}`
      );
      throw new Error(`Get wallet by BVN failed: ${error.message}`);
    }
  }
}

export default PsbService;

export async function handleWalletCredit(req, res) {
  const { userId, amount, reference } = req.body;

  try {
    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) return res.status(404).json({ error: "No wallet" });

    // Call 9PSB credit API
    const creditRes = await PsbService.walletCredit({
      accountNumber: account.accountNumber,
      amount,
      reference,
    });

    const apiData = creditRes?.data;

    // CRITICAL: Check nested status, NOT top-level success
    const isSuccess =
      apiData?.status === "success" && apiData?.data?.responseCode === "00";

    if (isSuccess) {
      // Only update DB if 9PSB says success
      const newBalance = (account.balance ?? 0) + amount;

      await prisma.account.update({
        where: { id: account.id },
        data: { balance: newBalance },
      });

      // Record transaction
      await prisma.transaction.create({
        data: {
          userId,
          accountId: account.id,
          amount,
          type: "CREDIT",
          reference,
        },
      });

      return res.json({
        success: true,
        message: "Wallet credited successfully",
        balance: newBalance,
      });
    } else {
      // Log failure reason
      logger.warn(`Wallet credit failed for ${account.accountNumber}:`, {
        responseCode: apiData?.data?.responseCode,
        message: apiData?.message,
      });

      return res.status(400).json({
        success: false,
        message: apiData?.message || "Transaction failed",
        responseCode: apiData?.data?.responseCode,
      });
    }
  } catch (error) {
    logger.error("Credit error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
