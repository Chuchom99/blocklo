import { jest } from "@jest/globals";

const axios = jest.fn();
axios.post = jest.fn();
jest.unstable_mockModule("axios", () => ({ default: axios }));

const { default: PsbService, classifyResponse, classifyStatusQuery, OUTCOME } = await import("../../services/psb.service.js");

beforeEach(() => {
  axios.mockReset();
  axios.post.mockReset();
  axios.post.mockResolvedValue({ data: { accessToken: "tok", expiresIn: 3600 } });
  PsbService.token = null;
});

describe("classifyResponse", () => {
  test.each([
    [{ status: "SUCCESS" }, OUTCOME.SUCCESS],
    [{ status: "SUCCESS", data: { responseCode: "00" } }, OUTCOME.SUCCESS],
    [{ status: "SUCCESS", data: { responseCode: "09" } }, OUTCOME.UNKNOWN],
    [{ status: "FAILED" }, OUTCOME.FAILED],
    [{ status: "PENDING" }, OUTCOME.UNKNOWN],
    [{ data: { responseCode: "51" } }, OUTCOME.FAILED],
    [{}, OUTCOME.UNKNOWN],
    [null, OUTCOME.UNKNOWN],
  ])("%j -> %s", (body, expected) => expect(classifyResponse(body)).toBe(expected));

  test("a successful status query does not mean a successful payment", () => {
    expect(classifyStatusQuery({ status: "SUCCESS", data: {} })).toBe(OUTCOME.UNKNOWN);
    expect(classifyStatusQuery({ status: "SUCCESS", data: { transactionStatus: "FAILED" } })).toBe(OUTCOME.FAILED);
    expect(classifyStatusQuery({ status: "SUCCESS", data: { status: "SUCCESS", responseCode: "00" } })).toBe(OUTCOME.SUCCESS);
  });
});

describe("walletToOtherBanks", () => {
  const args = {
    reference: "ref123",
    accountNo: "1100000001",
    amount: 5000,
    narration: "test",
    destinationAccount: "0123456789",
    destinationBankCode: "058",
    destinationName: "JOHN",
    senderName: "ME",
  };

  test("reports FAILED when 9PSB rejects (previously reported success)", async () => {
    axios.mockResolvedValue({ data: { status: "FAILED", message: "Insufficient funds" } });
    expect((await PsbService.walletToOtherBanks(args)).outcome).toBe(OUTCOME.FAILED);
  });

  test("reports SUCCESS only on explicit success", async () => {
    axios.mockResolvedValue({ data: { status: "SUCCESS", data: { responseCode: "00" } } });
    expect((await PsbService.walletToOtherBanks(args)).outcome).toBe(OUTCOME.SUCCESS);
  });

  test("a timeout is UNKNOWN and is not retried", async () => {
    axios.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ECONNABORTED" }));
    expect((await PsbService.walletToOtherBanks(args)).outcome).toBe(OUTCOME.UNKNOWN);
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test("a 400 means the request was rejected: FAILED", async () => {
    axios.mockRejectedValue(Object.assign(new Error("bad"), { response: { status: 400, data: {} } }));
    expect((await PsbService.walletToOtherBanks(args)).outcome).toBe(OUTCOME.FAILED);
  });

  test("sends our ledger reference to 9PSB", async () => {
    axios.mockResolvedValue({ data: { status: "SUCCESS" } });
    await PsbService.walletToOtherBanks(args);
    expect(axios.mock.calls[0][0].data.transaction.reference).toBe("ref123");
  });

  test("refuses to send without a reference", async () => {
    await expect(PsbService.walletToOtherBanks({ ...args, reference: undefined })).rejects.toThrow();
  });
});

test("name enquiry returns the name (the old code threw on an undefined variable)", async () => {
  axios.mockResolvedValue({ data: { status: "SUCCESS", data: { accountName: "JANE DOE" } } });
  expect(await PsbService.otherBankEnquiry("0123456789", "058")).toBe("JANE DOE");
});

test("getBalance returns null, not 0, when 9PSB is unreachable", async () => {
  axios.mockRejectedValue(new Error("down"));
  expect(await PsbService.getBalance("1100000001")).toBeNull();
});
