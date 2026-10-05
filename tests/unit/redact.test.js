import { looksLikePin, redactForLlm, redactObject, redactText } from "../../utils/redact.js";
import { publicUser } from "../../utils/serialize.js";
import { normalizeMsisdn, toLocalPhone } from "../../utils/phone.js";
import { parseAmount } from "../../utils/format.js";

describe("log redaction", () => {
  test("masks secrets in text", () => {
    const out = redactText('{"pin":"1234","password":"hunter2","bvn":"22222222222"} Authorization: Bearer abc.def.ghi');
    expect(out).not.toMatch(/1234|hunter2|22222222222|abc\.def\.ghi/);
  });

  test("masks long digit runs but keeps the last 4", () => {
    expect(redactText("account 0123456789")).toBe("account ******6789");
  });

  test("redacts sensitive keys in objects, recursively", () => {
    const out = redactObject({ user: { transactionPin: "$2a$hash", nin: "123", name: "Ada" }, headers: { Authorization: "Bearer x" } });
    expect(out.user.transactionPin).toBe("[REDACTED]");
    expect(out.user.nin).toBe("[REDACTED]");
    expect(out.user.name).toBe("Ada");
    expect(out.headers.Authorization).toBe("[REDACTED]");
  });

  test("detects PIN-like chat messages", () => {
    expect(looksLikePin("1234")).toBe(true);
    expect(looksLikePin(" 482913 ")).toBe(true);
    expect(looksLikePin("send 1234 to mom")).toBe(false);
  });

  test("strips BVN/NIN before text reaches the LLM", () => {
    expect(redactForLlm("my bvn is 22222222222")).not.toContain("22222222222");
  });
});

test("publicUser never exposes hashes or identity numbers", () => {
  const out = publicUser({
    id: "u1", email: "a@b.c", password: "$2a$x", transactionPin: "$2a$y", bvnEnc: "enc", bvn: "222", nin: "333", bvnLast4: "2222",
  });
  expect(JSON.stringify(out)).not.toMatch(/\$2a\$|enc|"222"|"333"/);
  expect(out.hasPin).toBe(true);
  expect(out.bvnLast4).toBe("2222");
});

test("phone normalisation", () => {
  expect(normalizeMsisdn("+234 801 234 5678")).toBe("2348012345678");
  expect(normalizeMsisdn("08012345678")).toBe("2348012345678");
  expect(toLocalPhone("2348012345678")).toBe("08012345678");
  // the old code did from.replace("234", "0"), which mangled numbers containing 234 later on
  expect(toLocalPhone("2348023423400")).toBe("08023423400");
});

test("parseAmount", () => {
  expect(parseAmount("₦5,000")).toBe(5000);
  expect(parseAmount("12.50")).toBe(12.5);
  expect(parseAmount("12.555")).toBeNull();
  expect(parseAmount("-5")).toBeNull();
  expect(parseAmount("abc")).toBeNull();
});
