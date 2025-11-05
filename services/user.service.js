import prisma from "../config/prisma.js";
import bcrypt from "bcryptjs";
import logger from "../config/logger.js";
import redis from "../config/redis.js";
import PsbService from "./psb.service.js";

const SALT_ROUNDS = 10;

class UserService {
  /**
   * Create a new user
   * @param {Object} data - { email, phone, password, firstName, lastName, pin, whatsappId }
   */
  static async createUser(data) {
    try {
      const {
        email,
        phone,
        password,
        firstName,
        lastName,
        pin,
        whatsappId,
        termsAgreed,
        gender,
        dateOfBirth,
        address,
        ninUserId,
        nin,
        bvn,
      } = data;

      // 🔍 Check if email, phone, or WhatsApp ID exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ email }, { phone }, { whatsappId: whatsappId || null }],
        },
      });
      if (existingUser) {
        const errorMessage =
          existingUser.email === email
            ? "Email already exists"
            : existingUser.phone === phone
            ? "Phone already exists"
            : "WhatsApp ID already exists";
        logger.error(`Failed to create user: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      // 🔐 Hash password & PIN
      const hashedPassword = password
        ? await bcrypt.hash(password, SALT_ROUNDS)
        : null;
      const hashedPin = pin ? await bcrypt.hash(pin, SALT_ROUNDS) : null;

      // 👤 Create user record
      const user = await prisma.user.create({
        data: {
          email,
          phone,
          password: hashedPassword,
          firstName,
          lastName,
          transactionPin: hashedPin,
          whatsappId,
          termsAgreed,
          gender,
          dateOfBirth,
          address,
          ninUserId,
          nin,
          bvn,
        },
      });

      // 🏦 Try creating 9PSB wallet
      try {
        const walletData = {
          firstName,
          lastName,
          accountName: `${firstName} ${lastName}`,
          email,
          phone,
          gender,
          dateOfBirth,
          address,
          ninUserId,
          ninUserId,
          nin, 
          bvn,

          // nextOfKinName,
          // nextOfKinPhone,
          // referralName,
          // referralPhone,
          // otherNames,
        };

        const psbWallet = await PsbService.createWallet(walletData);

        // ✅ Store wallet details
        await prisma.account.create({
          data: {
            userId: user.id,
            accountName: psbWallet.accountName,
            accountNumber: psbWallet.accountNumber,
            balance: 0.0,
            currency: psbWallet.currency || "NGN",
          },
        });

        logger.info(
          `9PSB wallet created for ${user.email}: ${psbWallet.accountNumber}`
        );
      } catch (walletError) {
        logger.error(
          `⚠️ Failed to create 9PSB wallet for ${user.email}: ${walletError.message}`
        );
      }

      logger.info(`✅ User created successfully: ${email}`);
      return user;
    } catch (error) {
      logger.error(`Error creating user: ${error.message}`);
      throw new Error(`Error creating user: ${error.message}`);
    }
  }
  /**
   * Find user by email, phone, or WhatsApp ID
   * @param {string} identifier
   */
  static async findByIdentifier(identifier) {
    try {
      const cacheKey = `user:${identifier}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info(`Cache hit for user ${identifier}`);
        return JSON.parse(cached);
      }

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: identifier },
            { phone: identifier },
            { whatsappId: identifier },
          ],
        },
      });
      if (!user) {
        logger.warn(`User not found for identifier: ${identifier}`);
      } else {
        await redis.setEx(cacheKey, 3600, JSON.stringify(user));
        logger.info(`Cached user ${identifier}`);
      }
      return user;
    } catch (error) {
      logger.error(`Error finding user by identifier: ${error.message}`);
      throw new Error(`Error finding user: ${error.message}`);
    }
  }

  /**
   * Verify transaction PIN
   * @param {string} userId
   * @param {string} pin
   */
  static async verifyPin(userId, pin) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.transactionPin) {
        logger.warn(
          `PIN verification failed: User ${userId} not found or no PIN set`
        );
        return false;
      }

      const isValid = await bcrypt.compare(pin, user.transactionPin);
      logger.info(
        `PIN verification for user ${userId}: ${
          isValid ? "successful" : "failed"
        }`
      );
      return isValid;
    } catch (error) {
      logger.error(`Error verifying PIN for user ${userId}: ${error.message}`);
      throw new Error(`Error verifying PIN: ${error.message}`);
    }
  }

  /**
   * Verify password (for web/mobile login)
   * @param {string} userId
   * @param {string} password
   */
  static async verifyPassword(userId, password) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.password) {
        logger.warn(
          `Password verification failed: User ${userId} not found or no password set`
        );
        return false;
      }

      const isValid = await bcrypt.compare(password, user.password);
      logger.info(
        `Password verification for user ${userId}: ${
          isValid ? "successful" : "failed"
        }`
      );
      return isValid;
    } catch (error) {
      logger.error(
        `Error verifying password for user ${userId}: ${error.message}`
      );
      throw new Error(`Error verifying password: ${error.message}`);
    }
  }

  /**
   * Update transaction PIN
   * @param {string} userId
   * @param {string} newPin
   */
  static async updatePin(userId, newPin) {
    try {
      const hashedPin = await bcrypt.hash(newPin, SALT_ROUNDS);
      const user = await prisma.user.update({
        where: { id: userId },
        data: { transactionPin: hashedPin },
      });
      logger.info(`Transaction PIN updated for user ${userId}`);
      return user;
    } catch (error) {
      logger.error(`Error updating PIN for user ${userId}: ${error.message}`);
      throw new Error(`Error updating PIN: ${error.message}`);
    }
  }

  /**
   * Update password
   * @param {string} userId
   * @param {string} newPassword
   */
  static async updatePassword(userId, newPassword) {
    try {
      const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
      const user = await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });
      logger.info(`Password updated for user ${userId}`);
      return user;
    } catch (error) {
      logger.error(
        `Error updating password for user ${userId}: ${error.message}`
      );
      throw new Error(`Error updating password: ${error.message}`);
    }
  }

  /**
   * Submit KYC data (e.g., BVN) for verification
   * @param {string} userId
   * @param {string} bvn
   */
  static async submitKyc(userId, bvn) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        logger.warn(`KYC submission failed: User ${userId} not found`);
        throw new Error("User not found");
      }

      // Check if BVN already exists
      const existingKyc = await prisma.kyc.findFirst({ where: { bvn } });
      if (existingKyc) {
        logger.warn(`KYC submission failed: BVN ${bvn} already exists`);
        throw new Error("BVN already exists");
      }

      // Call 9PSB API for verification via PsbService
      const result = await PsbService.verifyKyc(userId, bvn);

      logger.info(
        `KYC submitted for user ${userId}: BVN ${bvn}, Status ${result.status}`
      );
      return result;
    } catch (error) {
      logger.error(`Error submitting KYC for user ${userId}: ${error.message}`);
      throw new Error(`Error submitting KYC: ${error.message}`);
    }
  }

  /**
   * Get KYC status for a user
   * @param {string} userId
   */
  static async getKycStatus(userId) {
    try {
      const cacheKey = `kyc:${userId}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info(`Cache hit for KYC status of user ${userId}`);
        return JSON.parse(cached);
      }

      const kyc = await prisma.kyc.findFirst({
        where: { userId },
        select: { bvn: true, status: true, createdAt: true, updatedAt: true },
      });
      if (!kyc) {
        logger.warn(`KYC status not found for user ${userId}`);
        return { status: "NOT_SUBMITTED" };
      }

      await redis.setEx(cacheKey, 3600, JSON.stringify(kyc));
      logger.info(`Cached KYC status for user ${userId}`);
      return kyc;
    } catch (error) {
      logger.error(
        `Error getting KYC status for user ${userId}: ${error.message}`
      );
      throw new Error(`Error getting KYC status: ${error.message}`);
    }
  }
}

export default UserService;
