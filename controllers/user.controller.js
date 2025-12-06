// import UserService from '../services/user.service.js';
// import logger from '../config/logger.js';

// class UserController {
//   // Register new user
//   static async register(req, res) {
//     try {
//       const { email, phone, password, firstName, lastName, pin } = req.body;
//       const user = await UserService.createUser({ email, phone, password, firstName, lastName, pin });

//       res.status(201).json({ success: true, user });
//     } catch (err) {
//       console.error("Register Error:", err);
//       res.status(500).json({ success: false, message: "Failed to register user" });
//     }
//   }

//   // Login (phone/email + password)
//   static async login(req, res) {
//     try {
//       const { identifier, password } = req.body;
//       const user = await UserService.findByIdentifier(identifier);
//       if (!user) return res.status(404).json({ success: false, message: "User not found" });

//       const valid = await UserService.verifyPassword(user.id, password);
//       if (!valid) return res.status(401).json({ success: false, message: "Invalid credentials" });

//       res.json({ success: true, message: "Login successful", user });
//     } catch (err) {
//       console.error("Login Error:", err);
//       res.status(500).json({ success: false, message: "Login failed" });
//     }
//   }

//   // Verify PIN
//   static async verifyPin(req, res) {
//     try {
//       const { userId, pin } = req.body;
//       const valid = await UserService.verifyPin(userId, pin);
//       if (!valid) return res.status(401).json({ success: false, message: "Invalid PIN" });

//       res.json({ success: true, message: "PIN verified" });
//     } catch (err) {
//       console.error("Verify PIN Error:", err);
//       res.status(500).json({ success: false, message: "PIN verification failed" });
//     }
//   }
// }

// export default UserController;

import UserService from "../services/user.service.js";
import logger from "../config/logger.js";
import Joi from "joi";

class UserController {
  // Register new user

  static async register(req, res) {
    
    const schema = Joi.object({
      email: Joi.string().email().required(),
      phone: Joi.string()
        .pattern(/^[0-9]{10,15}$/)
        .required(),
      password: Joi.string().min(6).allow(null),
      firstName: Joi.string().required(),
      lastName: Joi.string().required(),
      pin: Joi.string().min(4).allow(null),
      whatsappId: Joi.string()
        .pattern(/^\+\d+$/)
        .optional()
        .allow(null),
      termsAgreed: Joi.boolean().valid(true).required(),

      // 9PSB mandatory fields
      gender: Joi.number().valid(0, 1).required(),
      dateOfBirth: Joi.string().required(),
      address: Joi.string().max(100).required(),
      ninUserId: Joi.string()
        .pattern(/^[A-Z]{6}-\d{4}$/)
        .required()
        .messages({
          "string.pattern.base":
            "Invalid ninUserId format, should be ABCDEF-0123",
        }),

      // 🆕 Optional 9PSB KYC identifiers
      nin: Joi.string()
        .pattern(/^[0-9]{11}$/)
        .optional()
        .messages({ "string.pattern.base": "NIN must be 11 digits" }),

      bvn: Joi.string()
        .pattern(/^[0-9]{11}$/)
        .optional()
        .messages({ "string.pattern.base": "BVN must be 11 digits" }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(
        `Validation error during registration: ${validationError.details[0].message}`
      );
      return res
        .status(400)
        .json({ success: false, message: validationError.details[0].message });
    }

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
      } = req.body;

      const user = await UserService.createUser({
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
      });

      logger.info(`User registered successfully: ${email}`);
      res.status(201).json({
        success: true,
        message: "User created successfully",
        user,
      });
    } catch (err) {
      logger.error(`Register Error: ${err.message}`);
      if (
        err.message.includes("Email already exists") ||
        err.message.includes("Phone already exists")
      ) {
        return res.status(400).json({ success: false, message: err.message });
      }
      res
        .status(500)
        .json({ success: false, message: "Failed to register user" });
    }
  }

  // Login (phone/email + password)
  static async login(req, res) {
    const schema = Joi.object({
      identifier: Joi.string().required().messages({
        "any.required": "Email or phone is required",
      }),
      password: Joi.string().required().messages({
        "any.required": "Password is required",
      }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(
        `Validation error during login: ${validationError.details[0].message}`
      );
      return res
        .status(400)
        .json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { identifier, password } = req.body;
      const user = await UserService.findByIdentifier(identifier);
      if (!user) {
        logger.warn(
          `Login failed: User not found for identifier ${identifier}`
        );
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const valid = await UserService.verifyPassword(user.id, password);
      if (!valid) {
        logger.warn(
          `Login failed: Invalid credentials for identifier ${identifier}`
        );
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials" });
      }

      logger.info(`User logged in successfully: ${identifier}`);
      res.json({ success: true, message: "Login successful", user });
    } catch (err) {
      logger.error(`Login Error: ${err.message}`);
      res.status(500).json({ success: false, message: "Login failed" });
    }
  }

  // Verify PIN
  static async verifyPin(req, res) {
    const schema = Joi.object({
      userId: Joi.string().required().messages({
        "any.required": "User ID is required",
      }),
      pin: Joi.string().required().messages({
        "any.required": "PIN is required",
      }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(
        `Validation error during PIN verification: ${validationError.details[0].message}`
      );
      return res
        .status(400)
        .json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { userId, pin } = req.body;
      const valid = await UserService.verifyPin(userId, pin);
      if (!valid) {
        logger.warn(`PIN verification failed for user ${userId}`);
        return res.status(401).json({ success: false, message: "Invalid PIN" });
      }

      logger.info(`PIN verified successfully for user ${userId}`);
      res.json({ success: true, message: "PIN verified" });
    } catch (err) {
      logger.error(`Verify PIN Error: ${err.message}`);
      res
        .status(500)
        .json({ success: false, message: "PIN verification failed" });
    }
  }

  // static async createUser({ email, phone, password, firstName, lastName, pin, whatsappId }) {
  //   try {
  //     // Check for existing user
  //     const existingUser = await prisma.user.findFirst({
  //       where: {
  //         OR: [{ email }, { phone }, { whatsappId }],
  //       },
  //     });
  //     if (existingUser) {
  //       if (existingUser.email === email) throw new Error('Email already exists');
  //       if (existingUser.phone === phone) throw new Error('Phone already exists');
  //       if (existingUser.whatsappId === whatsappId) throw new Error('WhatsApp ID already exists');
  //     }

  //     // Hash password and PIN
  //     const hashedPassword = password ? await bcrypt.hash(password, 10) : null;
  //     const hashedPin = pin ? await bcrypt.hash(pin, 10) : null;

  //     // Create user
  //     const user = await prisma.user.create({
  //       data: {
  //         email,
  //         phone,
  //         password: hashedPassword,
  //         firstName,
  //         lastName,
  //         transactionPin: hashedPin,
  //         whatsappId,
  //         termsAgreed: true,
  //         createdAt: new Date(),
  //         updatedAt: new Date(),
  //       },
  //     });

  //     logger.info(`User created: ${email}`);
  //     return user;
  //   } catch (error) {
  //     logger.error(`Error creating user: ${error.message}`);
  //     throw error;
  //   }
  // }
}

export default UserController;
