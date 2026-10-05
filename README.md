# Blocklo × 9PSB API

WhatsApp banking on top of 9PSB wallets: transfers, airtime, data, electricity and cable TV, through a chat bot and a REST API for the upcoming web and mobile app.

## How money moves

Every payment, from any channel, goes through one path in `services/payment-intent.service.js`:

1. **Draft.** The request is resolved on the server (`services/payment-builder.service.js`):
   - transfers: recipient name via name enquiry
   - data plans and TV bouquets: price from 9PSB
   - electricity: meter owner via biller validation

   It is checked against KYC-tier limits (`utils/constant.js`) and the live balance, then stored as a `PaymentIntent` in `DRAFT`. It expires after 5 minutes. **No money moves.**
2. **Authorize.** The user enters their PIN:
   - On WhatsApp, in an encrypted WhatsApp Flow (`flows/confirm-payment.flow.json`). The PIN is never typed in chat.
   - In the app, via `POST /api/me/payments/:id/authorize`.

   Five wrong PINs lock payments for 30 minutes. The intent moves `DRAFT → AUTHORIZED` atomically, so a replay can't authorize twice.
3. **Execute** (worker). The intent moves `AUTHORIZED → EXECUTING`, a `PENDING` ledger row is written, and 9PSB is called **once**. The row is then settled from 9PSB's actual answer: `SUCCESS`, `FAILED`, or `UNKNOWN` (for example, a timeout).
4. **Reconcile.** Every 5 minutes, `UNKNOWN`/`PENDING` rows are requeried with 9PSB and settled. Rows still unresolved after about an hour are flagged for review (`GET /api/admin/transactions/review`). 9PSB webhooks only *trigger* a requery; they are never trusted on their own.

The LLM assistant can only *draft* payments through the same path. It has no tool that executes anything.

## Security model

| Concern | Control |
| --- | --- |
| Spoofed WhatsApp messages | `X-Hub-Signature-256` HMAC verified on the raw body (`middlwares/metaSignature.middleware.js`) |
| WhatsApp retries replaying a transfer | Message-id dedupe in Redis; webhook acks immediately and processing runs in BullMQ |
| Concurrent messages and payments from one user | Per-user Redis lock in the workers |
| Flow endpoint abuse | Meta signature check, plus an HMAC `flow_token` bound to the intent and the WhatsApp number |
| Web/mobile auth | 15-minute JWT, plus a rotating refresh token with reuse detection (`services/auth.service.js`); every `/api/me` route is scoped to the logged-in user |
| Ops endpoints | `/api/admin/*`: `X-Admin-Key`, optional IP allowlist, audit log |
| 9PSB webhook | HTTP Basic auth (constant-time), optional IP allowlist |
| PII | BVN/NIN encrypted with AES-256-GCM, plus a keyed hash for uniqueness; logs are redacted (`utils/redact.js`); receipts are rendered in memory, never stored |
| Kill switch | `PAYMENTS_ENABLED=false` blocks all new payments |

## Setup

```bash
npm install --legacy-peer-deps   # pre-existing @langchain peer conflict
cp .env.example .env              # fill in every value; the app refuses to boot otherwise
npx prisma migrate deploy
npm start                         # API + workers in one process
npm test
```

To run workers separately: set `RUN_WORKERS=false` on the API servers and run `npm run worker`.

**Postman:** import `tests/postman/blocklo-api.postman_collection.json` and `tests/postman/blocklo-local.postman_environment.json`, and fill in the secret values from your `.env`. Run in order: Register → Login → the rest; Logout runs last.
- Login stores the tokens; payment creation stores `paymentId`.
- WhatsApp webhook requests are signed automatically.
- For the Flow endpoint, generate an encrypted body with `node scripts/flow-request.js`.

`tests/integration/postman.test.js` replays the whole collection against the app on every test run, so the payloads stay valid.

## Database (Neon)

- `DATABASE_URL` is Neon's **pooled** endpoint (`-pooler` host) with `pgbouncer=true`. The app uses it.
- `DIRECT_URL` is the **direct** endpoint (the same host without `-pooler`). `prisma migrate` uses it and fails through the pooler.
- Add `connect_timeout=15` to both so a suspended compute can wake up.
- The reconcile and expiry jobs query the database every 5 minutes, which keeps Neon's compute awake (its default auto-suspend is 5 minutes). Budget for an always-on compute, or raise those intervals in `jobs/workers.js`.
- Use a Neon **branch** for staging or sandbox testing instead of a separate database.

On a fresh database, just run `npx prisma migrate deploy`. The baseline steps below only apply to the old pre-migrations database.

## Deploying this version over the old one

1. **Rotate every secret** that was in the old committed `.env`. They are compromised.
2. **Baseline the existing database** (it was created with `db push`, so it has no migration history):
   ```bash
   npx prisma migrate resolve --applied 0_init
   npx prisma migrate deploy        # applies 20261005000000_security_hardening
   ```
   The migration converts `Transaction.status` in place and backfills missing or duplicate references. It also normalises `whatsappId` to digits only. Any id that would collide is left unchanged; check for these:
   ```sql
   SELECT id, "whatsappId" FROM "User" WHERE "whatsappId" ~ '\D';
   ```
3. **Encrypt existing BVN/NIN** and erase the plaintext:
   ```bash
   npm run pii:backfill              # dry run
   npm run pii:backfill -- --apply
   ```
   Existing users keep their current `kycLevel`. The old schema silently defaulted everyone to Tier 2, so review those levels.
4. **WhatsApp Flows.** Generate a new key pair **outside the repo**, upload it, and publish both Flows as *endpoint* Flows:
   ```bash
   FLOW_KEY_PASSPHRASE='…' node scripts/generate-flow-keys.js /secure/keys
   node scripts/upload-flow-key.js /secure/keys/flow_public_key.pem
   ```
   - Publish `flows/confirm-payment.flow.json` and set its id as `WHATSAPP_PAYMENT_FLOW_ID`.
   - Publish `flows/registration.flow.json` and set its id as `WHATSAPP_REGISTRATION_FLOW_ID`.
   - Set both Flows' endpoint URI to `https://<host>/api/whatsapp/flow`.
5. **Meta webhook:** callback URL `https://<host>/api/whatsapp/webhook`, verify token `WHATSAPP_VERIFY_TOKEN`. Set `WHATSAPP_APP_SECRET` to the Meta app secret.
6. **9PSB webhook:** `https://<host>/webhook/9psb/webhook` with the new Basic-auth credentials.
7. Use `https://` 9PSB URLs in production; the app refuses `http://` there. Turn on `PAYMENTS_ENABLED=true` only after a sandbox end-to-end run.

## API

**Public**
- `POST /api/users/register`
- `POST /api/users/login`
- `POST /api/users/refresh`

**Authenticated** (`Authorization: Bearer <accessToken>`)
- Account: `POST /api/users/logout`, `GET /api/users/me`
- Balance and history:
  - `GET /api/me/balance`
  - `GET /api/me/transactions`
  - `GET /api/me/transactions/:id/receipt` (PDF)
- Lookups: `GET /api/me/banks`, `GET /api/me/data-plans?phone=`
- Beneficiaries: `GET|POST /api/me/beneficiaries`, `DELETE /api/me/beneficiaries/:alias`
- Payments:
  - `POST /api/me/payments` with one of these bodies:
    - `{ kind: "TRANSFER", amount, accountNumber, bankCode }`
    - `{ kind: "AIRTIME", amount, phoneNumber }`
    - `{ kind: "DATA", phoneNumber, productId }`
    - `{ kind: "BILL", billType: "electricity" | "tv", billerId, customerId, amount?, itemId? }`
  - `POST /api/me/payments/:id/authorize` with `{ pin }` returns `202`. Then poll `GET /api/me/payments/:id`.
  - `POST /api/me/payments/:id/cancel`

**Admin** (`X-Admin-Key`): `/api/admin/psb/*` wallet operations, `GET /api/admin/transactions/review`, `POST /api/admin/transactions/:reference/requery`.

## Known follow-ups

- Linking a WhatsApp number to an app-registered account needs a verification flow (an OTP sent to that number). Until then, REST registration does not accept a `whatsappId`.
- Confirm the KYC tier limits in `utils/constant.js` with 9PSB/compliance.
- Check the 9PSB response field names against the production API docs:
  - name enquiry: `accountName`
  - TSQ: `data.transactionStatus` / `data.responseCode`
  - inflow webhook: `sessionID` / `accountNumber`

  The code treats anything it can't recognise as `UNKNOWN`, which goes to review rather than being guessed.
- Drop the deprecated plaintext `bvn`/`nin` columns in a later migration, once the backfill has run everywhere.
