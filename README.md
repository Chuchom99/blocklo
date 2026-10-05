# Blocklo

WhatsApp banking on top of 9PSB wallets: transfers, airtime, data, electricity and cable TV, through a chat bot and a REST API for the upcoming web and mobile app.

![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?logo=redis&logoColor=white)
![WhatsApp](https://img.shields.io/badge/WhatsApp_Cloud_API-25D366?logo=whatsapp&logoColor=white)

## Highlights

- **One payment path for every channel.** WhatsApp, the app and the AI assistant all use the same draft → authorize → execute → reconcile flow.
- **The PIN is never typed in chat.** It is entered in an encrypted WhatsApp Flow.
- **Each payment executes exactly once,** using atomic state transitions, message deduplication and per-user locks.
- **Nothing is guessed.** Unclear provider responses are requeried and sent for review.
- **Sensitive data is encrypted.** BVN and NIN are encrypted at rest, and logs are redacted.
- **The AI assistant has no execute tool.** It can only draft payments.

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
4. **Reconcile.** Every 5 minutes, `UNKNOWN`/`PENDING` rows are requeried with 9PSB and settled. Rows still unresolved after about an hour are flagged for review. 9PSB webhooks only *trigger* a requery; they are never trusted on their own.

The LLM assistant can only *draft* payments through the same path. It has no tool that executes anything.

## Security model

| Concern | Control |
| --- | --- |
| Spoofed WhatsApp messages | `X-Hub-Signature-256` HMAC verified on the raw body (`middlewares/metaSignature.middleware.js`) |
| WhatsApp retries replaying a transfer | Message-id dedupe in Redis; the webhook acks immediately and processing runs in BullMQ |
| Concurrent messages and payments from one user | Per-user Redis lock in the workers |
| Flow endpoint abuse | Meta signature check, plus an HMAC `flow_token` bound to the intent and the WhatsApp number |
| Web/mobile auth | 15-minute JWT, plus a rotating refresh token with reuse detection; every `/api/me` route is scoped to the logged-in user |
| Ops endpoints | Admin key, optional IP allowlist, audit log |
| 9PSB webhook | HTTP Basic auth (constant-time comparison), optional IP allowlist |
| PII | BVN/NIN encrypted with AES-256-GCM, plus a keyed hash for uniqueness; logs are redacted (`utils/redact.js`); receipts are rendered in memory, never stored |
| Kill switch | `PAYMENTS_ENABLED=false` blocks all new payments |

## Tech stack

| Area | Tools |
| --- | --- |
| Runtime | Node.js |
| Database | PostgreSQL (Neon), Prisma ORM and migrations |
| Queues and locks | Redis, BullMQ |
| Messaging | WhatsApp Cloud API, WhatsApp Flows (encrypted endpoint Flows) |
| Banking | 9PSB wallet and VAS APIs |
| AI | LangChain (draft-only assistant) |
| Auth | JWT access tokens with rotating refresh tokens |
| Testing | Automated tests, plus a Postman collection replayed on every test run |

## Getting started

### Prerequisites

- Node.js 18 or later
- A PostgreSQL database (Neon works well)
- Redis
- 9PSB sandbox credentials and a Meta WhatsApp Business app

### Setup

```bash
npm install --legacy-peer-deps   # pre-existing @langchain peer conflict
cp .env.example .env              # fill in every value; the app refuses to boot otherwise
npx prisma migrate deploy
npm start                         # API + workers in one process
npm test
```

To run workers separately, set `RUN_WORKERS=false` on the API servers and run `npm run worker`.

Turn on `PAYMENTS_ENABLED=true` only after a full end-to-end run in the sandbox. In production the app refuses `http://` 9PSB URLs.

### Database notes (Neon)

- `DATABASE_URL` is Neon's **pooled** endpoint (`-pooler` host) with `pgbouncer=true`. The app uses it.
- `DIRECT_URL` is the **direct** endpoint (the same host without `-pooler`). `prisma migrate` uses it, because migrations fail through the pooler.
- Add `connect_timeout=15` to both so a suspended compute can wake up.
- The reconcile and expiry jobs run every 5 minutes, which keeps Neon's compute awake. Budget for an always-on compute, or raise those intervals in `jobs/workers.js`.

### WhatsApp setup

- Publish `flows/confirm-payment.flow.json` and `flows/registration.flow.json` as *endpoint* Flows, with the endpoint URI `https://<host>/api/whatsapp/flow`.
- Generate the Flow key pair **outside the repo** with `scripts/generate-flow-keys.js`, and upload the public key with `scripts/upload-flow-key.js`.
- Webhook callback URL: `https://<host>/api/whatsapp/webhook`.

### Testing with Postman

Import `tests/postman/blocklo-api.postman_collection.json` and `tests/postman/blocklo-local.postman_environment.json`, then fill in the secret values from your `.env`. Run the requests in order: Register, then Login, then the rest, with Logout last.

- Login stores the tokens, and payment creation stores `paymentId`.
- WhatsApp webhook requests are signed automatically.
- For the Flow endpoint, generate an encrypted body with `node scripts/flow-request.js`.

`tests/integration/postman.test.js` replays the whole collection against the app on every test run, so the payloads stay valid.

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

**Admin**: wallet operations, a review queue for unresolved transactions, and manual requery.

## Roadmap

- Link a WhatsApp number to an app-registered account through OTP verification.
- Web and mobile apps on top of the REST API.
- Remove the deprecated plaintext BVN/NIN columns once encryption has been backfilled everywhere.

## License

Copyright (c) 2026 Osita Chisom. All rights reserved. This code is public for viewing and portfolio purposes only and is not open source.

## Author

**Osita Chisom** · [GitHub](https://github.com/Chuchom99) · ositachisom7@gmail.com
