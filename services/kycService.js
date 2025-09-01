import prisma from "../config/prisma.js";


class KycService {
  // Submit KYC
  static async submitKyc(userId, documentType, documentUrl) {
    const existing = await prisma.kyc.findUnique({ where: { userId } });
    if (existing) throw new Error("KYC already submitted");

    return prisma.kyc.create({
      data: {
        userId,
        documentType,
        documentUrl,
      },
    });
  }

  // Get user KYC
  static async getKyc(userId) {
    return prisma.kyc.findUnique({ where: { userId } });
  }

  // Admin updates status
  static async updateKycStatus(userId, status) {
    if (!["APPROVED", "REJECTED"].includes(status)) {
      throw new Error("Invalid status");
    }

    return prisma.kyc.update({
      where: { userId },
      data: { status },
    });
  }

  // List all pending KYCs (for admin dashboard)
  static async getPendingKycs() {
    return prisma.kyc.findMany({ where: { status: "PENDING" } });
  }
}

export default KycService;
