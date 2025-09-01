import PsbService from '../services/psb.service.js';

class PsbController {
  /**
   * Check wallet balance via PSB API
   */
  static async checkBalance(req, res) {
    try {
      const { accountNumber } = req.body;
      const balance = await PsbService.checkBalance(accountNumber);

      return res.status(200).json({ success: true, balance });
    } catch (error) {
      console.error("Error checking balance:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * Transfer funds via PSB API
   */
  static async transfer(req, res) {
    try {
      const { fromAccount, toAccount, amount, narration } = req.body;

      const transferResult = await PsbService.transfer({
        fromAccount,
        toAccount,
        amount,
        narration,
      });

      return res.status(201).json({ success: true, transferResult });
    } catch (error) {
      console.error("PSB Transfer Error:", error);
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  /**
   * Validate an account number via PSB API
   */
  static async validateAccount(req, res) {
    try {
      const { accountNumber, bankCode } = req.body;

      const accountInfo = await PsbService.validateAccount({
        accountNumber,
        bankCode,
      });

      return res.status(200).json({ success: true, accountInfo });
    } catch (error) {
      console.error("Account Validation Error:", error);
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  static async verifyBVN(req, res) {
  try {
    const { bvn } = req.body;
    const result = await PsbService.verifyBVN(bvn);
    return res.status(200).json({ success: true, result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

}

export default PsbController;
