import KycService from "../services/kycService.js";

export const submitKyc = async (req, res) => {
  try {
    const { documentType, documentUrl } = req.body;
    const userId = req.user.id; // from auth middleware

    const kyc = await KycService.submitKyc(userId, documentType, documentUrl);
    res.json({ success: true, kyc });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getKyc = async (req, res) => {
  try {
    const userId = req.user.id;
    const kyc = await KycService.getKyc(userId);
    res.json({ success: true, kyc });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateKycStatus = async (req, res) => {
  try {
    const { userId, status } = req.body;
    const kyc = await KycService.updateKycStatus(userId, status);
    res.json({ success: true, kyc });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
