import bcrypt from "bcryptjs";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import { maintenanceQueue } from "../config/queue.js";
import PsbService from "./psb.service.js";
import WhatsAppService from "./whatsapp.services.js";
import { hashPin, validateNewPin } from "./pin.service.js";
import { audit } from "./audit.service.js";
import { blindIndex, decrypt, encrypt } from "../utils/crypto.js";
import { normalizeMsisdn, toLocalPhone } from "../utils/phone.js";
import { badRequest, conflict } from "../utils/errors.js";

const PASSWORD_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", PASSWORD_ROUNDS);

class UserService {
  static findByWhatsappId(waId) {
    return prisma.user.findUnique({
      where: { whatsappId: normalizeMsisdn(waId) },
      include: { accounts: { take: 1, orderBy: { createdAt: "asc" } } },
    });
  }

  static findById(id) {
    return prisma.user.findUnique({ where: { id }, include: { accounts: { take: 1, orderBy: { createdAt: "asc" } } } });
  }

  // Login identifier: email or local phone number. Never cached: the row holds hashes.
  static findByIdentifier(identifier) {
    const value = String(identifier).trim();
    return prisma.user.findFirst({
      where: { OR: [{ email: value.toLowerCase() }, { phone: toLocalPhone(value) }] },
    });
  }

  // Always runs one bcrypt comparison so response time doesn't reveal whether the user exists.
  static async verifyPassword(user, password) {
    const ok = await bcrypt.compare(String(password), user?.password || DUMMY_HASH);
    return Boolean(user?.password) && ok;
  }

  // Creates the user in PENDING_WALLET and queues 9PSB wallet creation, which can be
  // slow or flaky. The user becomes ACTIVE once the wallet exists.
  //
  // whatsappId must only ever come from a verified source (a signed Flow token),
  // never from a request body.
  static async register(data, { whatsappId } = {}) {
    const pinError = validateNewPin(data.pin);
    if (pinError) throw badRequest(pinError, "WEAK_PIN");
    if (!data.bvn && !data.nin) throw badRequest("BVN or NIN is required.", "KYC_REQUIRED");

    const email = data.email.trim().toLowerCase();
    const phone = toLocalPhone(data.phone || whatsappId);
    const waId = whatsappId ? normalizeMsisdn(whatsappId) : null;
    const bvnHash = blindIndex(data.bvn);
    const ninHash = blindIndex(data.nin);

    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { phone },
          ...(waId ? [{ whatsappId: waId }] : []),
          ...(bvnHash ? [{ bvnHash }] : []),
          ...(ninHash ? [{ ninHash }] : []),
        ],
      },
      select: { id: true },
    });
    // Deliberately vague so registration can't be used to probe which BVNs are on file.
    if (existing) throw conflict("An account with these details already exists.", "ALREADY_EXISTS");

    const user = await prisma.user.create({
      data: {
        email,
        phone,
        whatsappId: waId,
        password: data.password ? await bcrypt.hash(data.password, PASSWORD_ROUNDS) : null,
        transactionPin: await hashPin(data.pin),
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        gender: data.gender,
        dateOfBirth: data.dateOfBirth,
        address: data.address?.trim(),
        ninUserId: data.ninUserId || null,
        bvnEnc: encrypt(data.bvn),
        bvnHash,
        bvnLast4: data.bvn ? data.bvn.slice(-4) : null,
        ninEnc: encrypt(data.nin),
        ninHash,
        ninLast4: data.nin ? data.nin.slice(-4) : null,
        termsAgreed: data.termsAgreed === true,
        kycLevel: 1,
        status: "PENDING_WALLET",
      },
    });

    await maintenanceQueue.add(
      "create-wallet",
      { userId: user.id },
      { jobId: `wallet-${user.id}`, attempts: 5, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: true },
    );
    await audit(user.id, "user.registered", { metadata: { channel: waId ? "whatsapp" : "api" } });
    logger.info(`[USER] registered ${user.id}, wallet creation queued`);
    return user;
  }

  // Job handler. Throws on failure so BullMQ retries with backoff.
  static async createWalletForUser(userId, { finalAttempt = false } = {}) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { accounts: true } });
    if (!user || user.accounts.length) return;

    try {
      const wallet = await PsbService.createWallet({
        trackingRef: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        gender: user.gender,
        dateOfBirth: user.dateOfBirth,
        address: user.address,
        ninUserId: user.ninUserId,
        bvn: decrypt(user.bvnEnc),
        nin: decrypt(user.ninEnc),
      });

      await prisma.$transaction([
        prisma.account.create({
          data: { userId, accountNumber: wallet.accountNumber, accountName: wallet.accountName, currency: wallet.currency },
        }),
        prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } }),
      ]);

      if (user.whatsappId) {
        await WhatsAppService.sendMessage(
          user.whatsappId,
          `🎉 Your account is ready, ${user.firstName}!\n\nAccount number: ${wallet.accountNumber}\nBank: 9 Payment Service Bank (9PSB)\n\nSay *balance* to check your money.`,
        );
      }
    } catch (err) {
      logger.error(`[USER] wallet creation failed for ${userId}: ${err.message}`);
      if (finalAttempt) {
        await audit("system", "wallet.creation_failed", { target: userId });
        if (user.whatsappId) {
          await WhatsAppService.sendMessage(
            user.whatsappId,
            "We couldn't finish opening your account. Our team has been notified and will contact you.",
          );
        }
      }
      throw err;
    }
  }
}

export default UserService;
