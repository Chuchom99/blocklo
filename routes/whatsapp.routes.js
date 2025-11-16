// // import express from "express";
// // import WhatsAppController from "../controllers/whatsapp.controller.js";

// // const router = express.Router();

// // // Log every incoming WhatsApp request
// // router.use((req, res, next) => {
// //   const timestamp = new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" });
// //   console.log(`[WhatsApp Endpoint] ${timestamp} - ${req.method} ${req.originalUrl}`);
// //   next();
// // });

// // // Webhook Verification (GET)
// // router.get("/webhook", (req, res) => {
// //   const mode = req.query["hub.mode"];
// //   const token = req.query["hub.verify_token"];
// //   const challenge = req.query["hub.challenge"];

// //   // Check verify token
// //   if (mode === "subscribe" && token === process.env.WHATSAPP_ACCESS_TOKEN) {
// //     console.log("✅ WhatsApp webhook verified successfully!");
// //     return res.status(200).send(challenge);
// //   }

// //   console.warn("❌ WhatsApp webhook verification failed!");
// //   return res.sendStatus(403);
// // });

// // // ✅ Handle Webhook Messages (POST)
// // router.post("/webhook", WhatsAppController.handleWebhook);

// // // ✅ Flow webhook (for encrypted interactive flows)
// // router.post("/flow", WhatsAppController.handleFlow);

// // // ✅ Manual health check
// // router.get("/flow/health", (req, res) => {
// //   const response = {
// //     response: { status: "SUCCESS", message: "Manual health check successful" },
// //   };
// //   const encoded = Buffer.from(JSON.stringify(response)).toString("base64");
// //   res.status(200).type("text/plain").send(encoded);
// // });

// // export default router;


// import express from "express";
// import WhatsAppController from "../controllers/whatsapp.controller.js";

// const router = express.Router();

// // Log all incoming WhatsApp requests
// router.use((req, res, next) => {
//   const timestamp = new Date().toLocaleString("en-US", { timeZone: "Africa/Lagos" });
//   console.log(`[WhatsApp Endpoint] ${timestamp} - ${req.method} ${req.originalUrl}`);
//   next();
// });

// // Webhook verification (GET)
// router.get("/webhook", WhatsAppController.verifyWebhook);

// // Incoming messages
// router.post("/webhook", WhatsAppController.handleWebhook);

// // Flow data endpoint (for encrypted flow)
// router.post("/flow", WhatsAppController.handleFlow);

// // Health check
// router.get("/flow/health", WhatsAppController.handleHealthCheck);

// export default router;


import express from "express";
import WhatsAppController from "../controllers/whatsapp.controller.js";

 const router = express.Router();

router.get("/webhook", WhatsAppController.verifyWebhook);
router.post("/webhook", WhatsAppController.handleWebhook);
router.post("/flow", WhatsAppController.handleFlow);

export default router;