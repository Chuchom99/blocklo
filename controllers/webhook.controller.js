// controllers/webhook.controller.js
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";

export const handle9psbWebhook = async (req, res) => {
  try {
    const payload = req.body;
    logger.info(`[WEBHOOK] 9PSB → ${JSON.stringify(payload)}`);

    // Acknowledge immediately (as requested)
    res.json({
      success: true,
      status: "success",
      code: "00",
      message: "Acknowledged",
    });

    // Process in background
    process.nextTick(async () => {
      try {
        const { transactionReference, status, amount, debitAccount, creditAccount, narration } = payload;

        if (!transactionReference) {
          logger.warn("[WEBHOOK] Missing transactionReference");
          return;
        }

        // Find pending transaction
        const transaction = await prisma.transaction.findFirst({
          where: {
            reference: transactionReference,
            status: "PENDING",
          },
          include: { account: true },
        });

        if (!transaction) {
          logger.info(`[WEBHOOK] No pending transaction found for ${transactionReference}`);
          return;
        }

        const isSuccess = status?.toLowerCase() === "success" || status === "00";

        if (isSuccess) {
          // Final success → do nothing (already debited)
          await prisma.transaction.update({
            where: { id: transaction.id },
            data: {
              status: "SUCCESS",
              metadata: payload,
            },
          });

          logger.info(`[WEBHOOK] Transaction ${transactionReference} confirmed SUCCESS`);
        } else {
          // FAILED → REVERSE
          await prisma.$transaction([
            // Reverse balance
            prisma.account.update({
              where: { id: transaction.accountId },
              data: { balance: { increment: transaction.amount } },
            }),
            // Mark failed
            prisma.transaction.update({
              where: { id: transaction.id },
              data: {
                status: "FAILED",
                metadata: { ...payload, error: "9PSB rejected" },
              },
            }),
          ]);

          logger.warn(`[WEBHOOK] Transaction ${transactionReference} FAILED → Reversed`);
        }
      } catch (error) {
        logger.error(`[WEBHOOK] Processing error: ${error.message}`);
      }
    });
  } catch (error) {
    logger.error(`[WEBHOOK] Fatal error: ${error.message}`);
    // Still acknowledge so 9PSB doesn't retry endlessly
    if (!res.headersSent) {
      res.json({
        success: true,
        status: "success",
        code: "00",
        message: "Acknowledged",
      });
    }
  }
};