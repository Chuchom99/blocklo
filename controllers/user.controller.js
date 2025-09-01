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


import UserService from '../services/user.service.js';
import logger from '../config/logger.js';
import Joi from 'joi';

class UserController {
  // Register new user
  static async register(req, res) {
    const schema = Joi.object({
      email: Joi.string().email().required().messages({
        'string.email': 'Invalid email format',
        'any.required': 'Email is required',
      }),
      phone: Joi.string().pattern(/^[0-9]{10,15}$/).required().messages({
        'string.pattern.base': 'Phone must be 10-15 digits',
        'any.required': 'Phone is required',
      }),
      password: Joi.string().min(6).allow(null).messages({
        'string.min': 'Password must be at least 6 characters',
      }),
      firstName: Joi.string().required().messages({
        'any.required': 'First name is required',
      }),
      lastName: Joi.string().required().messages({
        'any.required': 'Last name is required',
      }),
      pin: Joi.string().min(4).allow(null).messages({
        'string.min': 'Transaction PIN must be at least 4 characters',
      }),
      whatsappId: Joi.string().pattern(/^\+\d+$/).optional().allow(null)
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error during registration: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { email, phone, password, firstName, lastName, pin, whatsappId } = req.body;
      const user = await UserService.createUser({ email, phone, password, firstName, lastName, pin, whatsappId});
      logger.info(`User registered successfully: ${email}`);
      res.status(201).json({ success: true, message: 'User created successfully', user });
    } catch (err) {
      logger.error(`Register Error: ${err.message}`);
      if (err.message.includes('Email already exists') || err.message.includes('Phone already exists')) {
        return res.status(400).json({ success: false, message: err.message });
      }
      res.status(500).json({ success: false, message: 'Failed to register user' });
    }
  }

  // Login (phone/email + password)
  static async login(req, res) {
    const schema = Joi.object({
      identifier: Joi.string().required().messages({
        'any.required': 'Email or phone is required',
      }),
      password: Joi.string().required().messages({
        'any.required': 'Password is required',
      }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error during login: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { identifier, password } = req.body;
      const user = await UserService.findByIdentifier(identifier);
      if (!user) {
        logger.warn(`Login failed: User not found for identifier ${identifier}`);
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const valid = await UserService.verifyPassword(user.id, password);
      if (!valid) {
        logger.warn(`Login failed: Invalid credentials for identifier ${identifier}`);
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      logger.info(`User logged in successfully: ${identifier}`);
      res.json({ success: true, message: 'Login successful', user });
    } catch (err) {
      logger.error(`Login Error: ${err.message}`);
      res.status(500).json({ success: false, message: 'Login failed' });
    }
  }

  // Verify PIN
  static async verifyPin(req, res) {
    const schema = Joi.object({
      userId: Joi.string().required().messages({
        'any.required': 'User ID is required',
      }),
      pin: Joi.string().required().messages({
        'any.required': 'PIN is required',
      }),
    });

    const { error: validationError } = schema.validate(req.body);
    if (validationError) {
      logger.warn(`Validation error during PIN verification: ${validationError.details[0].message}`);
      return res.status(400).json({ success: false, message: validationError.details[0].message });
    }

    try {
      const { userId, pin } = req.body;
      const valid = await UserService.verifyPin(userId, pin);
      if (!valid) {
        logger.warn(`PIN verification failed for user ${userId}`);
        return res.status(401).json({ success: false, message: 'Invalid PIN' });
      }

      logger.info(`PIN verified successfully for user ${userId}`);
      res.json({ success: true, message: 'PIN verified' });
    } catch (err) {
      logger.error(`Verify PIN Error: ${err.message}`);
      res.status(500).json({ success: false, message: 'PIN verification failed' });
    }
  }
}

export default UserController;