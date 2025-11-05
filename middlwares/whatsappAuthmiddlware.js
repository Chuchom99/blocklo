import prisma from '../config/prisma.js';
import logger from '../config/logger.js';

const whatsappAuthMiddleware = async (req, res, next) => {
  const { from } = req.body; // WhatsApp number from payload (e.g., +2348060519115)

  if (!from) {
    logger.warn('[WhatsApp Auth] No whatsappId provided in request body');
    return res.status(401).json({ success: false, message: 'WhatsApp ID required' });
  }

  try {
    // Normalize phone number (add + if missing, assuming E.164 format)
    const whatsappId = from.startsWith('+') ? from : `+${from}`;

    // Check if user exists with this whatsappId
    const user = await prisma.user.findFirst({
      where: { whatsappId },
    });

    if (!user) {
      logger.warn(`[WhatsApp Auth] User not found for whatsappId: ${whatsappId}`);
      return res.status(401).json({ success: false, message: 'User not found for this WhatsApp number' });
    }

    // Attach userId to request for controllers
    req.userId = user.id;
    logger.info(`[WhatsApp Auth] Authenticated user ${user.id} with whatsappId ${whatsappId}`);
    next();
  } catch (error) {
    logger.error(`[WhatsApp Auth] Error: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Authentication failed' });
  }
};

export default whatsappAuthMiddleware;