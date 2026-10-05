// Generate a new RSA-2048 keypair for WhatsApp Flows endpoint encryption.
//
//   FLOW_KEY_PASSPHRASE='...' node scripts/generate-flow-keys.js <output-dir>
//
// <output-dir> must be OUTSIDE this repository (e.g. a secrets mount). Then set
// WHATSAPP_FLOW_PRIVATE_KEY_PATH and WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE and run
// scripts/upload-flow-key.js with the public key.
import crypto from "crypto";
import fs from "fs";
import path from "path";

const outDir = process.argv[2];
const passphrase = process.env.FLOW_KEY_PASSPHRASE;

if (!outDir || !passphrase || passphrase.length < 16) {
  console.error("Usage: FLOW_KEY_PASSPHRASE=<16+ chars> node scripts/generate-flow-keys.js <output-dir-outside-repo>");
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const target = path.resolve(outDir);
if (target === repoRoot || target.startsWith(repoRoot + path.sep)) {
  console.error("Refusing to write keys inside the repository.");
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase },
});

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, "flow_private_key.pem"), privateKey, { mode: 0o600 });
fs.writeFileSync(path.join(target, "flow_public_key.pem"), publicKey);
console.log(`Keys written to ${target}. Upload flow_public_key.pem with scripts/upload-flow-key.js.`);
