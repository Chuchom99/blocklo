import config from "./config/env.js";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";

import userRoutes from "./routes/user.routes.js";
import meRoutes from "./routes/me.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import webhookRoutes from "./routes/webhooks.js";
import { errorHandler, notFoundHandler, requestId } from "./middlwares/error.middleware.js";

const app = express();

// Behind one reverse proxy (needed for correct req.ip in rate limits and allowlists).
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(requestId);
app.use(helmet());
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false }));
// Keep the raw body: Meta's webhook signature is computed over the exact bytes.
app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
if (!config.isTest) app.use(morgan(config.isProd ? "combined" : "dev"));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/users", userRoutes);
app.use("/api/me", meRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/webhook", webhookRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
