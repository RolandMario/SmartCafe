# SMARTCAFE — Virtual Top-Up & Bills Payment Platform

A full-stack Nigerian **VTU (Virtual Top-Up)** platform:

| App | Stack | Purpose |
|---|---|---|
| `mobile/` | **React Native (Expo SDK 57)** | Customer app — buy Airtime, Data, Cable TV, Electricity, WAEC, Bulk SMS |
| `backend/` | **NestJS + MongoDB (Mongoose)** | REST API — auth, wallets, purchases, vendor integration |
| `admin/` | **Next.js (App Router) + Tailwind** | Admin dashboard — catalog, users, transactions, funding |

## Services

- **Airtime** — MTN, Airtel, GLO, 9mobile (50-custom amount)
- **Data** — all major networks, multiple bundle sizes (catalog-driven)
- **Cable TV** — DStv, GOtv, StarTimes with **smart-card customer verification**
- **Electricity** — 12 Nigerian Discos (IKEDC, EKEDC, AEDC, PHED, ...) with **meter verification** and **token delivery**
- **WAEC** — Result Checker PIN (instant) and **full registration** (candidate details → PINs/serials)
- **Bulk SMS** — sender-ID campaigns with live unit-cost quoting

## Architecture highlights

- **Wallet-first, atomic transactions** — every purchase debits the wallet and records a ledger entry inside a **MongoDB transaction** (requires the replica set below), then calls the vendor, and refunds automatically on vendor failure.
- **Vendor abstraction** (`VendorProvider` interface) with three implementations:
  - `MockProvider` (default) — simulated success/failure, tokens, PINs — no keys needed.
  - `VTPassProvider` — production adapter for VTPass (airtime/data/cable/electricity/WAEC + messaging API for SMS). Switch with `VENDOR_PROVIDER=vtpass` and add your keys.
  - `EbulksmsProvider` — production adapter for bulk SMS via the ebulksms JSON API (`sendsms.json`, `application/json` content type, `234…` international recipient numbers, 160-char pages up to 612 chars). Switch with `VENDOR_PROVIDER=ebulksms` and add `EBULK_USERNAME` / `EBULK_API_KEY`; SMS-only, so keep `vtpass` for the other services.
- **Per-service vendor routing (admin-configurable)** — each service (AIRTIME, DATA, CABLE, ELECTRICITY, WAEC, SMS) can be pinned to its own provider (`mock`/`vtpass`/`ebulksms`) from the admin **Vendors** page (`GET/PATCH /admin/vendors`). The choice is persisted in Mongo (`vendorconfigs`), seeded from `VENDOR_PROVIDER` at startup, and applied to purchases, verifications and requeries immediately — no restart needed. The page flags incompatible pairings (e.g. ebulksms only supports SMS).
- **Idempotency** — every order has a unique `requestId` (uuid) forwarded to the vendor; failed calls can be **re-queried**.
- **JWT auth** (access + rotating refresh), RBAC (`user`/`admin`), validation pipes, Helmet, Swagger at `/api/docs`.
- **Transaction PIN** — every customer purchase requires a 4-digit PIN (`GET /users/pin/status`, `POST /users/pin`, verified in `TransactionsService` before any wallet debit / vendor call).
- **Shareable SmartCafe receipts** — a standard branded receipt (logo + app name) is shown after every transaction and from the history detail screen, with a native **Share** action.

---

## Getting started

### 0. Prerequisites

- Node.js ≥ 20, npm
- A MongoDB database. **MongoDB Atlas** (shared dev cluster) is pre-configured in
  `backend/.env` and requires no local install. Because purchases use MongoDB
  transactions, only a replica-set-backed database works — Atlas is always one.

### 1. Database

The backend already points at a shared Atlas cluster (`vtu` database) via
`MONGODB_URI` in `backend/.env`. You can replace it with your own:

```bash
# Atlas (recommended) — replica set built in
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/vtu?retryWrites=true&w=majority

# Or a local single-node replica set (Docker)
docker compose up -d
docker exec -it vtu-mongo mongosh --eval 'rs.initiate()'
MONGODB_URI=mongodb://localhost:27017/vtu?replicaSet=rs0

# Or the bundled helper (downloads MongoDB 7 into .mongo/)
./scripts/dev-db.sh start     # then MONGODB_URI=mongodb://localhost:27017/vtu
```

### 2. Backend (NestJS)

```bash
cd backend
npm install
cp .env.example .env     # PORT=4000; VENDOR_PROVIDER=mock for local dev
npm run seed             # seeds 51 catalog products + admin + demo user
npm run start:dev        # http://localhost:4000/api · Swagger: /api/docs
```

Seeded accounts:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@vtuapp.com` | `Admin@12345` |
| Demo user | `demo@vtuapp.com` | `Password@123` (wallet ₦50,000) |

### 3. Mobile app (Expo)

```bash
cd mobile
npm install
cp .env.example .env     # optional; auto-detects host from the Expo dev server
npx expo start           # then press i / a / w
```

- On a **physical device**, set `EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000/api` in `.env`.
- Demo credentials above; fund the wallet via admin, or any wallet-top-up.

### 4. Admin (Next.js)

```bash
cd admin
npm install
cp .env.example .env.local
npm run dev              # http://localhost:3000  (login with admin@vtuapp.com)
```

Includes: dashboard (volume/commission by service), transaction management with **vendor requery**, user enable/disable, catalog CRUD, wallet funding approvals.

---

## Using VTPass live keys

1. Set `VENDOR_PROVIDER=vtpass` in `backend/.env`.
2. Fill in the VTPass credentials:
   ```
   VTPASS_BASE_URL=https://sandbox.vtpass.com/api   # sandbox; live: https://vtpass.com/api
   VTPASS_API_KEY=<your api key>
   VTPASS_SECRET_KEY=<your SK_... secret key>
   VTPASS_PUBLIC_KEY=<your PK_... public key>
   ```
   VTPass authenticates with **custom request headers, not HTTP Basic auth**:
   POST requests need `api-key` + `secret-key`; GET requests need
   `api-key` + `public-key` (generate the key pair in your VTPass profile
   → API Keys → "click to generate your public and secret key").
3. Keep the mock provider for CI/local: revert to `VENDOR_PROVIDER=mock`.

## Payment gateways: Monnify & Paystack (wallet funding)

Wallet top-ups run through a **hosted checkout** (card, bank transfer, USSD). Two
gateway adapters ship in `backend/src/payments/` and implement a shared
`PaymentGateway` interface:

- **Monnify** — `MONNIFY_*` env vars, host `https://sandbox.monnify.com` (sandbox)
  or `https://api.monnify.com` (live).
- **Paystack** — `PAYSTACK_SECRET_KEY` (test = `sk_test_...`, live = `sk_live_...`),
  host `https://api.paystack.co` (test/live is chosen by the key; amounts are
  sent in kobo).

Setup for Monnify:

1. Get your Monnify **test** credentials from the dashboard (`apiKey`,
   `secretKey`, `contractCode`).
2. In `backend/.env` set:
   ```
   MONNIFY_BASE_URL=https://sandbox.monnify.com   # live: https://api.monnify.com
   MONNIFY_API_KEY=your_monnify_api_key
   MONNIFY_SECRET_KEY=your_monnify_secret_key
   MONNIFY_CONTRACT_CODE=your_monnify_contract_code
   MONNIFY_WEBHOOK_INSECURE=true                  # sandbox only — no signature header
   ```
3. Configure your Monnify webhook URL (dashboard → Developer → Webhook URLs →
   Transaction Completion) to point at
   `https://<your-backend>/api/funding/webhook/monnify`. Production uses the
   `monnify-signature` (HMAC-SHA512) header to validate incoming notifications.
4. In production set `MONNIFY_WEBHOOK_INSECURE=false` and, if you like, pin
   `MONNIFY_ALLOWED_IP` to Monnify's production IP (`35.242.133.146`). The
   HMAC signature is the primary security control; the IP list is optional
   hardening.

Setup for Paystack:

1. Get your **secret key** from the dashboard (Settings → API Keys). Test keys
   (`sk_test_...`) work against the sandbox; live keys (`sk_live_...`) switch
   the same endpoint to production.
2. In `backend/.env` set:
   ```
   PAYSTACK_SECRET_KEY=sk_test_xxxxxxxx
   ```
   (Optional: `PAYSTACK_REDIRECT_URL`, `PAYSTACK_ALLOWED_IP`,
   `PAYSTACK_WEBHOOK_INSECURE`.)
3. Configure your Paystack webhook URL (Dashboard → Settings → Webhooks) to
   point at `https://<your-backend>/api/funding/webhook/paystack`. Paystack
   always signs requests with the `x-paystack-signature` header (HMAC-SHA512
   of the raw body with your secret key) — even in test mode.

Flow: `POST /funding/deposit` returns a `checkoutUrl` → the app opens it in the
browser → the gateway redirects to the configured redirect URL (or the derived
callback) → the server verifies the transaction against the gateway API and
credits the wallet, idempotently. The client may pick a gateway with an
optional `provider` body field (`monnify` | `paystack`); it is honoured only if
that gateway is configured. Otherwise the first configured gateway is used
(Monnify → Paystack). If no gateway is configured, deposits fall back to the
manual admin-approval flow, which is unchanged.

Related endpoints: `GET /funding/payment/:reference` (verify + credit),
`POST /funding/webhook/monnify` + `POST /funding/webhook/paystack` (signed
webhooks), `GET /funding/webhook/monnify/callback` +
`GET /funding/webhook/paystack/callback` (redirect landing pages).

## Project layout

```
├── backend/
│   └── src/
│       ├── auth|users|wallet|catalog|transactions|funding|admin   # modules
│       ├── airtime|data|cable|electricity|waec|sms                 # service modules
│       ├── vendors/          # VendorProvider + Mock + VTPass adapters
│       ├── seeds/            # catalog seed + user seed script
│       └── config/           # env validation
├── mobile/
│   └── src/app/              # Expo Router (auth, tabs, purchase/*, confirm, receipt)
│       src/api|store|components|constants|types|utils
├── admin/
│   └── app/                  # Next.js App Router (login + dashboard group)
│       lib/                  # typed API client + session refresh
└── scripts/dev-db.sh         # local MongoDB replica-set helper
```

## API surface (Swagger: `/api/docs`)

- `POST /auth/register|login|refresh`, `GET /users/me`
- `GET /catalog`, `GET /catalog/services`
- `POST /airtime/purchase`, `/data/purchase`, `/cable/verify|purchase`,
  `/electricity/verify|purchase`, `/waec/purchase`, `/sms/quote|purchase`
- `GET /wallet`, `/wallet/ledger`, `POST /funding/deposit`
- `GET|POST /transactions...` (history, detail, requery)
- `/admin/dashboard|transactions|users|catalog`, `/admin/vendors` (per-service provider routing), `/admin/vendors/balance`,
  `/funding/admin/*` (RBAC admin-only)

## Tests

```bash
cd backend && npm run build    # type-check + compile
bash /tmp/vtu-test.sh          # (reference) full API smoke test
cd mobile && npx tsc --noEmit  # mobile type-check
cd admin && npm run build      # admin build
```# SmartCafe
