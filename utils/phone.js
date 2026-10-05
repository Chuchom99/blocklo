// Canonical forms:
//   msisdn (WhatsApp id): "2348012345678" — digits only, country code, no "+"
//   local NG phone:       "08012345678"

export function normalizeMsisdn(input) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^[789]\d{9}$/.test(digits)) return `234${digits}`;
  return digits;
}

export function toLocalPhone(input) {
  const msisdn = normalizeMsisdn(input);
  return /^234\d{10}$/.test(msisdn) ? `0${msisdn.slice(3)}` : msisdn;
}

export const isNigerianMobile = (input) => /^0[789]\d{9}$/.test(toLocalPhone(input));
