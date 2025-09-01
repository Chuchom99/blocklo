import express from 'express';
import UserController from '../controllers/user.controller.js';

const router = express.Router();

// Auth & User
router.post('/register', UserController.register);
router.post('/login', UserController.login);
router.post('/verify-pin', UserController.verifyPin);

export default router;
