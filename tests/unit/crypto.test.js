import { jest } from "@jest/globals";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

// Generate a throwaway Flow keypair before config loads.
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyPath = path.join(os.tmpdir(), `flow-test-${process.pid}.pem`);
fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
process.env.WHATSAPP_FLOW_PRIVATE_KEY_PATH = keyPath;

jest.unstable_mockModule("axios", () => ({ default: { post: jest.fn() } }));
const { blindIndex, decrypt, encrypt, safeEqual } = await import("../../utils/crypto.js");
const { default: WhatsAppService } = await import("../../services/whatsapp.services.js");
const { validateNewPin } = await import("../../services/pin.service.js");

afterAll(() => fs.rmSync(keyPath, { force: true }));

describe("field encryption", () => {
  test("round-trips and is non-deterministic", () => {
    const a = encrypt("22222222222");
    const b = encrypt("22222222222");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("22222222222");
  });

  test("tampering is detected", () => {
    const buf = Buffer.from(encrypt("secret"), "base64");
    buf[buf.length - 1] ^= 1;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  test("blind index is deterministic and doesn't reveal the value", () => {
    expect(blindIndex("22222222222")).toBe(blindIndex("22222222222"));
    expect(blindIndex("22222222222")).not.toContain("2222");
  });

  test("safeEqual", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

// Simulates exactly what Meta sends, per the Flows endpoint spec.
function metaEncrypt(body) {
  const aesKey = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(body)), cipher.final(), cipher.getAuthTag()]);
  const encKey = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, aesKey);
  return {
    request: { encrypted_flow_data: data.toString("base64"), encrypted_aes_key: encKey.toString("base64"), initial_vector: iv.toString("base64") },
    aesKey,
    iv,
  };
}

describe("WhatsApp Flow encryption", () => {
  test("decrypts a Meta request and encrypts a response Meta can read", () => {
    const { request, aesKey, iv } = metaEncrypt({ action: "ping", version: "3.0" });
    const decrypted = WhatsAppService.decryptFlowRequest(request);
    expect(decrypted.body.action).toBe("ping");

    const response = WhatsAppService.encryptFlowResponse({ data: { status: "active" } }, decrypted.aesKey, decrypted.iv);
    const buf = Buffer.from(response, "base64");
    const flipped = Buffer.from(iv.map((b) => ~b & 0xff));
    const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, flipped);
    decipher.setAuthTag(buf.subarray(-16));
    const plain = Buffer.concat([decipher.update(buf.subarray(0, -16)), decipher.final()]).toString();
    expect(JSON.parse(plain)).toEqual({ data: { status: "active" } });
  });
});

test("PIN policy rejects weak PINs", () => {
  expect(validateNewPin("1234")).toMatch(/sequence/);
  expect(validateNewPin("4321")).toMatch(/sequence/);
  expect(validateNewPin("0000")).toMatch(/same digit/);
  expect(validateNewPin("12a4")).toMatch(/4 digits/);
  expect(validateNewPin("12345")).toMatch(/4 digits/);
  expect(validateNewPin("2580")).toBeNull();
});
