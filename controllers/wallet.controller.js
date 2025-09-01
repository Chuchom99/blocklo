import WalletService from '../services/wallet.service.js';

class WalletController {
  /**
   * Create wallet for a user
   */
  static async createWallet(req, res) {
    try {
      const { userId } = req.body;
      const wallet = await WalletService.createWallet(userId);
      return res.status(201).json({ success: true, wallet });
    } catch (error) {
      console.error("Error creating wallet:", error);
      return res.status(500).json({ success: false, message: "Failed to create wallet" });
    }
  }

  /**
   * Get wallet details
   */
  static async getWallet(req, res) {
    try {
      const { userId } = req.params;
      const wallet = await WalletService.getWallet(userId);
      if (!wallet) {
        return res.status(404).json({ success: false, message: "Wallet not found" });
      }
      return res.status(200).json({ success: true, wallet });
    } catch (error) {
      console.error("Error fetching wallet:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch wallet" });
    }
  }

  /**
   * Credit wallet (requires transaction pin)
   */
  static async creditWallet(req, res) {
    try {
      const { userId, amount, pin } = req.body;
      const wallet = await WalletService.creditWallet(userId, amount, pin);
      return res.status(200).json({ success: true, wallet });
    } catch (error) {
      console.error("Error crediting wallet:", error);
      return res.status(400).json({ success: false, message: error.message });
    }
  }

  /**
   * Debit wallet (requires transaction pin)
   */
  static async debitWallet(req, res) {
    try {
      const { userId, amount, pin } = req.body;
      const wallet = await WalletService.debitWallet(userId, amount, pin);
      return res.status(200).json({ success: true, wallet });
    } catch (error) {
      console.error("Error debiting wallet:", error);
      return res.status(400).json({ success: false, message: error.message });
    }
  }
}

export default WalletController;
