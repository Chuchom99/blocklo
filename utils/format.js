export const naira = (n) =>
  `₦${Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const maskAccount = (acct) => (acct ? `******${String(acct).slice(-4)}` : "");

// Parse "5,000", "₦5000", "5000.50" into a number with at most 2 decimals, or null.
export function parseAmount(input) {
  const cleaned = String(input ?? "").replace(/[₦,\s]|naira|ngn/gi, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}
