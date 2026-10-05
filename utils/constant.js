// Per-KYC-tier limits in naira, modelled on CBN tiered-KYC rules.
// Confirm the exact figures with 9PSB/compliance before going live.
export const TIER_LIMITS = {
  1: { perTransaction: 50_000, daily: 50_000 },
  2: { perTransaction: 100_000, daily: 200_000 },
  3: { perTransaction: 5_000_000, daily: 5_000_000 },
};

export const MIN_AMOUNT = {
  TRANSFER: 50,
  AIRTIME: 50,
  DATA: 50,
  BILL: 100,
};

// Electricity tokens below this are rejected by most discos.
export const MIN_ELECTRICITY_AMOUNT = 1000;

export const PAYMENT_INTENT_TTL_MS = 5 * 60 * 1000;

export const PIN_POLICY = {
  maxAttempts: 5,
  lockMinutes: 30,
};

export const PSB_BANK_CODE_9PSB = "120001";
