// One-off backfill after the security migration: encrypt plaintext BVN/NIN into
// the *Enc / *Hash / *Last4 columns and erase the plaintext. Idempotent.
//
//   node scripts/encrypt-pii.js            # dry run: counts only
//   node scripts/encrypt-pii.js --apply    # write changes
import config from "../config/env.js";
import prisma from "../config/prisma.js";
import { blindIndex, encrypt } from "../utils/crypto.js";

const apply = process.argv.includes("--apply");
if (config.isTest) throw new Error("Not for test environments");

const fieldsFor = (row, withLast4) => {
  const data = {};
  for (const f of ["bvn", "nin"]) {
    if (!row[f]) continue;
    data[`${f}Enc`] = encrypt(row[f]);
    data[`${f}Hash`] = blindIndex(row[f]);
    if (withLast4) data[`${f}Last4`] = row[f].slice(-4);
    data[f] = null;
  }
  return data;
};

async function backfill(model, withLast4) {
  const rows = await prisma[model].findMany({
    where: { OR: [{ bvn: { not: null } }, { nin: { not: null } }] },
    select: { id: true, bvn: true, nin: true },
  });
  console.log(`${model}: ${rows.length} row(s) with plaintext identity numbers`);
  if (!apply) return;
  for (const row of rows) {
    await prisma[model].update({ where: { id: row.id }, data: fieldsFor(row, withLast4) });
  }
  console.log(`${model}: encrypted ${rows.length} row(s)`);
}

await backfill("user", true);
await backfill("kYC", false);
if (!apply) console.log("Dry run only. Re-run with --apply to write changes.");
await prisma.$disconnect();
