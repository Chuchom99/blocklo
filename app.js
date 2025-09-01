import dotenv from "dotenv";
import express from "express";
import morgan from "morgan"; // for request logging
import cors from "cors";

// Load env variables
dotenv.config();

// Routes
import userRoutes from "./routes/user.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
// import transactionRoutes from "./routes/transaction.routes.js";
import psbRoutes from "./routes/psb.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js"

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan("dev")); // Logs requests

// Routes
app.use("/api/users", userRoutes);
app.use("/api/wallet", walletRoutes);
// app.use("/api/transactions", transactionRoutes);
app.use("/api/psb", psbRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api", whatsappRoutes)

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "WhatsApp Fintech API" });
});

// Error handling
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(500).json({ success: false, message: "Internal Server Error" });
});



export default app