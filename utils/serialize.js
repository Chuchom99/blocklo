// Allowlisted views of database rows. Never return raw Prisma rows to a client:
// they contain password and PIN hashes and encrypted identity numbers.

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    kycLevel: user.kycLevel,
    status: user.status,
    bvnLast4: user.bvnLast4 ?? null,
    ninLast4: user.ninLast4 ?? null,
    hasPin: Boolean(user.transactionPin),
    createdAt: user.createdAt,
  };
}

export function publicAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    accountNumber: account.accountNumber,
    accountName: account.accountName,
    provider: account.provider,
    currency: account.currency,
    status: account.status,
  };
}

export function publicTransaction(t) {
  return {
    id: t.id,
    reference: t.reference,
    type: t.type,
    kind: t.kind,
    status: t.status,
    amount: Number(t.amount),
    description: t.description,
    destinationAccount: t.destinationAccount ? `******${t.destinationAccount.slice(-4)}` : null,
    destinationName: t.destinationName,
    createdAt: t.createdAt,
  };
}

export function publicIntent(intent, transaction) {
  return {
    id: intent.id,
    kind: intent.kind,
    amount: Number(intent.amount),
    summary: intent.summary,
    status: intent.status,
    expiresAt: intent.expiresAt,
    transaction: transaction ? publicTransaction(transaction) : null,
  };
}
