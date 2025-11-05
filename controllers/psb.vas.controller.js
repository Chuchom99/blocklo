import PsbVasService from "../services/psb.vas.services.js";
import logger from "../config/logger.js";

class PsbVasController {
  static async getNetwork(req, res) {
    try {
      const { phone } = req.query;
      const result = await PsbVasService.getNetwork(phone);
      res.status(200).json(result);
    } catch (err) {
      logger.error(err.message);
      res.status(500).json({ error: err.message });
    }
  }

  static async buyAirtime(req, res) {
    try {
      const result = await PsbVasService.buyAirtime(req.body);
      res.status(200).json(result);
    } catch (err) {
      logger.error(err.message);
      res.status(500).json({ error: err.message });
    }
  }

  static async getDataPlans(req, res) {
    try {
      const { phone } = req.query;
      const result = await PsbVasService.getDataPlans(phone);
      res.status(200).json(result);
    } catch (err) {
      logger.error(err.message);
      res.status(500).json({ error: err.message });
    }
  }

  static async buyData(req, res) {
    try {
      const result = await PsbVasService.buyData(req.body);
      res.status(200).json(result);
    } catch (err) {
      logger.error(err.message);
      res.status(500).json({ error: err.message });
    }
  }

  static async getTopupStatus(req, res) {
    try {
      const { transReference } = req.query;
      const result = await PsbVasService.getTopupStatus(transReference);
      res.status(200).json(result);
    } catch (err) {
      logger.error(err.message);
      res.status(500).json({ error: err.message });
    }
  }

  // ⚡ Bills Payment Section
  static async getCategories(req, res) {
    try {
      const result = await PsbVasService.getBillCategories();
      res.status(200).json(result);
    } catch (err) {
      logger.error(err.message);
      res.status(500).json({ error: err.message });
    }
  }

  static async getCategoryBillers(req, res) {
    try {
      const { categoryId } = req.params;
      const result = await PsbVasService.getCategoryBillers(categoryId);
      res.status(200).json(result);
    } catch (err) {
      logger.error(err.message);
      res.status(500).json({ error: err.message });
    }
  }

  static async getBillerFields(req, res) {
    try {
      const { billerId } = req.params;
      const result = await PsbVasService.getBillerFields(billerId);
      res.status(200).json(result);
    } catch (err) {
      logger.error(err.message);
      res.status(500).json({ error: err.message });
    }
  }

  static async validateBillerInput(req, res) {
    try {
      const result = await PsbVasService.validateBillerInputs(req.body);
      res.status(200).json(result);
    } catch (err) {
      logger.error(err.message);
      res.status(500).json({ error: err.message });
    }
  }

  static async payBill(req, res) {
    try {
      const result = await PsbVasService.payBill(req.body);
      res.status(200).json(result);
    } catch (err) {
      logger.error(err.message);
      res.status(500).json({ error: err.message });
    }
  }

  static async getBillStatus(req, res) {
    try {
      const { transReference } = req.query;

      if (!transReference) {
        return res
          .status(400)
          .json({ error: "Missing transReference parameter" });
      }

      const result = await PsbVasService.getBillStatus(transReference);
      res.status(200).json(result);
    } catch (err) {
      logger.error(`[API] getBillStatus Error: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  }
}

export default PsbVasController;
