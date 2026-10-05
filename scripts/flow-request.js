// Build an encrypted WhatsApp Flows request (what Meta sends to /api/whatsapp/flow),
// and decrypt the server's response. For local testing with Postman or curl.
//
//   node scripts/flow-request.js encrypt <flow_public_key.pem> '{"version":"3.0","action":"ping"}'
//   node scripts/flow-request.js decrypt <aesKeyB64> <ivB64> <responseBody>
import crypto from "crypto";
import fs from "fs";

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "encrypt" && args.length === 2) {
  const [keyPath, json] = args;
  const payload = JSON.parse(json);
  const aesKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final(), cipher.getAuthTag()]);
  const encryptedKey = crypto.publicEncrypt(
    { key: fs.readFileSync(keyPath, "utf8"), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    aesKey,
  );
  console.log("Request body:\n");
  console.log(
    JSON.stringify({
      encrypted_flow_data: data.toString("base64"),
      encrypted_aes_key: encryptedKey.toString("base64"),
      initial_vector: iv.toString("base64"),
    }),
  );
  console.log(`\nTo decrypt the response:\nnode scripts/flow-request.js decrypt ${aesKey.toString("base64")} ${iv.toString("base64")} <responseBody>`);
} else if (cmd === "decrypt" && args.length === 3) {
  const [keyB64, ivB64, response] = args;
  const aesKey = Buffer.from(keyB64, "base64");
  const flippedIv = Buffer.from(Buffer.from(ivB64, "base64").map((b) => ~b & 0xff));
  const buf = Buffer.from(response, "base64");
  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, flippedIv);
  decipher.setAuthTag(buf.subarray(-16));
  console.log(Buffer.concat([decipher.update(buf.subarray(0, -16)), decipher.final()]).toString("utf8"));
} else {
  console.error(
    "Usage:\n  node scripts/flow-request.js encrypt <flow_public_key.pem> '<json>'\n  node scripts/flow-request.js decrypt <aesKeyB64> <ivB64> <responseBody>",
  );
  process.exit(1);
}
