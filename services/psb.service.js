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
    let token;
    try {
      token = await this.getWAASAuthToken();
      if (!token) throw new Error("No WAAS token retrieved");
    } catch (e) {
      logger.error(`[PSB] Auth error for walletEnquiry: ${e.message}`);
      return {
        status: "failed",
        responseCode: "401",
        responseDescription: "Auth failed",
        availableBalance: 0,
      };
    }

    const url = `${PSB_BASE_URL}/wallet_enquiry`;
    const payload = { accountNo };

    // logger.info(`[PSB] → Requesting walletEnquiry for ${accountNo}`);
    // logger.debug(`[PSB] URL: ${url}`);
    // logger.debug(`[PSB] Payload: ${JSON.stringify(payload)}`);

    try {
      const { data } = await axios.post(url, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      });

      // ✅ Log the entire response
      // logger.info(
      //   `[PSB] ← walletEnquiry response (${accountNo}): ${JSON.stringify(
      //     data,
      //     null,
      //     2
      //   )}`
      // );

      return data;
    } catch (error) {
      const resp = error.response?.data || {};
      const statusCode = error.response?.status || "unknown";
      const responseCode =
        resp?.responseCode || resp?.data?.responseCode || "ERR";
      const description =
        resp?.responseDescription ||
        resp?.data?.responseDescription ||
        resp?.message ||
        error.message;

      // 🔥 Log everything about the failure
      logger.error(
        `[PSB] walletEnquiry failed [${statusCode}/${responseCode}] for ${accountNo}: ${description}`
      );
      logger.debug(`[PSB] Raw error data: ${JSON.stringify(resp, null, 2)}`);

      return {
        status: "failed",
        responseCode,
        responseDescription: description,
        availableBalance:
          resp?.data?.availableBalance ?? resp?.availableBalance ?? 0,
        raw: resp,
      };
    }
  }

  static async getBalance(accountNo) {
    try {
      const data = await this.walletEnquiry(accountNo);

      const amount =
        data?.data?.data?.availableBalance ??
        data?.data?.availableBalance ??
        data?.availableBalance ??
        0;

      return parseFloat(amount);
    } catch (err) {
      logger.error("[PSB] Balance fetch error:", {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });

      return 0; // fail-safe
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
        transactionType: "CREDIT_WALLET",
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
          `Initiating ${type.toUpperCase()} transfer [WAAS] → ${JSON.stringify(
            payload
          )}`
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

      //  Check if transaction is successful
      const isSuccess =
        result?.data?.isSuccessful === true ||
        result?.data?.status?.toUpperCase?.() === "SUCCESS" ||
        result?.data?.responseCode === "00";

      const transactionStatus = isSuccess ? "SUCCESS" : "FAILED";

      // 💾 Store transaction and update balance
      await prisma.$transaction(
        async (tx) => {
          // Record transaction log
          await tx.transaction.create({
            data: {
              userId: account.userId,
              accountId: account.id,
              amount,
              type: type.toUpperCase(),
              reference: transactionId,
              status: transactionStatus, //  Add this column to schema if not yet present
              metadata: result.data ? JSON.stringify(result.data) : null,
            },
          });

          // Only update balance on success
          if (isSuccess) {
            // const newBalance =
            //   type.toLowerCase() === "debit"
            //     ? account.balance - amount
            //     : account.balance + amount;

            // await tx.account.update({
            //   where: { id: account.id },
            //   data: { balance: newBalance },
            // });

            logger.info(
              `Account ${accountNo} ${type} successful `
            );
          } else {
            logger.warn(
              `Transfer FAILED → Balance NOT changed for ${accountNo}`
            );
          }
        },
        {
          timeout: 30000, // ← THIS IS THE FIX
          maxWait: 10000,
        }
      );

      //  Return clear structured response
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
  // static async walletToOtherBanks({
  //   accountNo,
  //   amount,
  //   narration,
  //   destinationAccount,
  //   destinationBankCode,
  //   destinationName,
  //   merchant,
  //   senderName,
  // }) {
  //   try {
  //     if (
  //       !accountNo ||
  //       !amount ||
  //       !narration ||
  //       !destinationAccount ||
  //       !destinationBankCode ||
  //       !merchant
  //     ) {
  //       throw new Error(
  //         "Missing required fields for wallet to other banks transfer"
  //       );
  //     }

  //     const transactionRef = uuidv4().replace(/-/g, "").slice(0, 18);
  //     const orderRef = uuidv4().replace(/-/g, "").slice(0, 18);

  //     // Generate distinct, compliant description (longer + unique)
  //     const formattedDescription = `Blocklo Transfer: ${narration} to ${
  //       destinationName || "Account"
  //     } (${destinationAccount}) - Ref ${transactionRef.slice(0, 8)}`;

  //     const senderFullName = senderName;

  //     const payload = {
  //       transaction: {
  //         reference: transactionRef,
  //       },
  //       order: {
  //         amount: String(amount),
  //         currency: "NGN",
  //         description: formattedDescription,
  //         country: "NG",
  //       },
  //       customer: {
  //         account: {
  //           number: destinationAccount, // Receipient account number
  //           bank: destinationBankCode, // 6-digit beneficiary bank code
  //           name: destinationName, // sender's name
  //           senderaccountnumber: accountNo, // sender wallet
  //           sendername: senderFullName, // sender's name
  //         },
  //       },
  //       merchant: {
  //         isFee: merchant.isFee,
  //         merchantFeeAccount: merchant.isFee
  //           ? merchant.merchantFeeAccount
  //           : "0000000000",
  //         merchantFeeAmount: merchant.isFee ? merchant.merchantFeeAmount : "0",
  //       },
  //       transactionType: "INTRA_BANK",
  //       narration,
  //       merchantBearsFee: false,
  //     };

  //     // Log payload length for debugging
  //     logger.info(
  //       `[9PSB] Description length: ${payload.order.description.length} chars`
  //     );

  //     const token = await this.getWAASAuthToken();
  //     logger.info(
  //       `[9PSB] Wallet→OtherBanks Payload: ${JSON.stringify(payload, null, 2)}`
  //     );

  //     const response = await axios.post(
  //       `${PSB_BASE_URL}/wallet_other_banks`,
  //       payload,
  //       {
  //         headers: {
  //           "Content-Type": "application/json",
  //           Authorization: `Bearer ${token}`,
  //         },
  //         timeout: 40000,
  //       }
  //     );

  //     const data = response.data;
  //     if (!data) throw new Error("Empty response from 9PSB");
  //     if (data.status?.toUpperCase() !== "SUCCESS" && data.success !== true) {
  //       throw new Error(
  //         `Wallet to other banks failed: ${
  //           data.message || "Unknown error"
  //         } (Code: ${data.responseCode || "N/A"})`
  //       );
  //     }

  //     logger.info(
  //       `✅ Wallet to other banks transfer successful [${transactionRef}]`
  //     );
  //     return data;
  //   } catch (error) {
  //     const status = error.response?.status;
  //     const detail = error.response?.data || error.message;
  //     logger.error(
  //       `❌ Error wallet to other banks [${
  //         status || "no status"
  //       }]: ${JSON.stringify(detail)}`
  //     );
  //     throw new Error(`Wallet to other banks failed: ${error.message}`);
  //   }
  // }

  static async walletToOtherBanks({
  accountNo,
  amount,
  narration,
  destinationAccount,
  destinationBankCode,
  destinationName,
  senderName,
  merchant = { isFee: false },
  userId,      // Required for DB save
  accountId,   // Required for DB save
}) {
  try {
    // 1. Generate unique refs
    const transactionRef = uuidv4().replace(/-/g, "").slice(0, 18);

    // 2. Build 9PSB-compliant description
    const formattedDescription = `Blocklo Transfer: ${narration} to ${
      destinationName || "Account"
    } (${destinationAccount}) - Ref ${transactionRef.slice(0, 8)}`;

    // 3. Final 9PSB payload (exactly what they expect)
    const payload = {
      transaction: {
        reference: transactionRef,
      },
      order: {
        amount: String(amount),
        currency: "NGN",
        description: formattedDescription,
        country: "NG",
      },
      customer: {
        account: {
          number: destinationAccount,
          bank: destinationBankCode,
          name: destinationName || "Recipient",
          senderaccountnumber: accountNo,
          sendername: senderName,
        },
      },
      merchant: {
        isFee: merchant.isFee || false,
        merchantFeeAccount: merchant.isFee ? merchant.merchantFeeAccount : "0000000000",
        merchantFeeAmount: merchant.isFee ? String(merchant.merchantFeeAmount || 0) : "0",
      },
      transactionType: "INTRA_BANK",
      narration,
      merchantBearsFee: false,
    };

    logger.info(`[9PSB] Transfer → ${destinationAccount} | ₦${amount} | Ref: ${transactionRef}`);

    const token = await this.getWAASAuthToken();

    const response = await axios.post(
      `${PSB_BASE_URL}/wallet_other_banks`,  // Make sure this is correct in .env
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 45000,
      }
    );

    const result = response.data;

    // 4. SUCCESS → Save transaction to DB (non-blocking)
    if (result?.status?.toUpperCase() === "SUCCESS" || result?.success === true) {
      try {
        await prisma.transaction.create({
          data: {
            userId,
            accountId,
            reference: transactionRef,                    // ← Real 9PSB ref
            amount: parseFloat(amount),
            type: "DEBIT",
            status: "SUCCESS",
            description: formattedDescription,
            destinationAccount,
            destinationName: destinationName || "Recipient",
            metadata: result,   // Full response for audit/debugging
          },
        });
        logger.info(`[DB] Transaction saved → ${transactionRef}`);
      } catch (dbError) {
        logger.error(`[DB] Failed to save transaction (money already moved!):`, dbError);
        // DO NOT throw — user already lost money
      }
    }

    // 5. Return full result + our ref for receipt generation
    return {
      success: true,
      transactionRef,
      data: result,
    };

  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    logger.error(`[9PSB] Transfer FAILED → ${destinationAccount} | ₦${amount} | Error: ${errMsg}`);
    throw new Error(`Transfer failed: ${errMsg}`);
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
          account: {
            number: accountNumber,
          },
          bank: bankCode,
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

      logger.info(`Other bank enquiry successful for ${accountNumber}@${bank}`);
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
