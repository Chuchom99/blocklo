// Upload the Flows public key to Meta for this WhatsApp phone number.
//
//   node scripts/upload-flow-key.js /secure/path/flow_public_key.pem
//
// Uses WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID from the environment.
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config({ quiet: true });

const keyPath = process.argv[2];
const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId } = process.env;

if (!keyPath || !token || !phoneNumberId) {
  console.error("Usage: node scripts/upload-flow-key.js <public-key.pem>  (needs WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID)");
  process.exit(1);
}

const publicKey = fs.readFileSync(keyPath, "utf8").trim();
if (!publicKey.startsWith("-----BEGIN PUBLIC KEY-----")) {
  console.error("That file is not a PEM public key.");
  process.exit(1);
}

try {
  const { data } = await axios.post(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/whatsapp_business_encryption`,
    new URLSearchParams({ business_public_key: publicKey }),
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 },
  );
  console.log("Uploaded:", data);
} catch (err) {
  console.error("Upload failed:", err.response?.status, err.response?.data?.error?.message || err.message);
  process.exit(1);
}
