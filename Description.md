SmartCafe is a full-stack Nigerian VTU/bills payment platform. Via a React Native mobile app, customers buy airtime, data, cable TV, electricity, WAEC pins and bulk SMS, backed by a wallet-first NestJS API with transaction PINs and multi-vendor integrations, plus a Next.js admin dashboard.

## 2. Purpose & target audience

SmartCafe solves a common problem for people in Nigeria: buying everyday digital services — phone airtime, data bundles, cable TV subscriptions, electricity tokens, WAEC pins, and bulk SMS — previously required juggling multiple apps, prepaid scratch cards, or unreliable street vendors. Each channel has its own payment flow, its own risk of fraud or delay, and no unified record of what was bought.

SmartCafe consolidates all of these into **one wallet-first app**:

- **Single prepaid wallet** — fund once with a card, bank transfer, or USSD, then spend across every service.
- **Instant, digital delivery** — airtime, data, electricity tokens, WAEC serial/PINs, and SMS results are delivered inside the app, with vendor confirmation.
- **Transaction PIN protection** — every purchase is authorised by a customer-set 4-digit PIN, reducing the impact of a stolen phone.
- **Full history & shareable receipts** — every order is recorded with a branded, shareable receipt (PNG / PDF / text), which doubles as proof of payment.
- **24/7 availability** — no shop hours; purchases complete whenever the upstream provider is online.

**Target audience:** Nigerian consumers and small businesses who regularly buy airtime/data, pay cable or electricity bills, need WAEC result-checker PINs, or run bulk-SMS campaigns (e.g. shops, co-ops, churches, SMEs). The admin dashboard serves platform operators — managing catalog, users, transactions, vendor routing, and wallet-funding approvals.

## 3. Setup & accessing the main features

### Prerequisites
- Node.js ≥ 20 and npm
- A MongoDB database. The backend ships pointing at a shared **MongoDB Atlas** cluster in `backend/.env` (no local install needed). Because purchases and refunds run inside MongoDB transactions, a **replica-set-backed** database is required — Atlas is always one. A local single-node replica set can be started with `docker compose up -d` or `./scripts/dev-db.sh start`.

### Backend (NestJS API)
```bash
cd backend
npm install
cp .env.example .env     # PORT=4000; sandbox vendor/gateway keys are pre-filled
npm run seed             # seeds 51 catalog products + admin + demo user
npm run start:dev        # http://localhost:4000/api · Swagger docs: /api/docs
```
For fully-local development with no external calls, set `VENDOR_PROVIDER=mock` in `backend/.env` — the bundled MockProvider simulates vendors with no keys required (see the comments in `.env.example`).

### Seeded login credentials
| Role | Email | Password |
|---|---|---|
| Admin dashboard | `admin@vtuapp.com` | `Admin@12345` |
| Demo customer | `demo@vtuapp.com` | `Password@123` (wallet ₦50,000) |

### Mobile app (Expo / React Native)
```bash
cd mobile
npm install
cp .env.example .env     # defaults to the hosted backend (https://smart-cafe-bay.vercel.app/api)
npx expo start           # then press i / a / w
```
- To run against a local backend instead, set `EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000/api` in `mobile/.env` and restart `expo start`.
- **Main features**: sign in with the demo customer credentials above (or register a new account), fund the wallet from the Profile → “Top up wallet” screen, then buy Airtime / Data / Cable / Electricity / WAEC / SMS from the home screen. Every purchase asks for your 4-digit transaction PIN (set it under Profile → “Set / change transaction PIN”). Orders and receipts appear in the Transactions tab.

### Admin dashboard (Next.js)
```bash
cd admin
npm install
cp .env.example .env.local   # NEXT_PUBLIC_API_URL defaults to the hosted backend
npm run dev                  # http://localhost:3000  (login with admin@vtuapp.com / Admin@12345)
```
Includes: dashboard (volume/commission by service), transaction management with vendor requery, user enable/disable, catalog CRUD, per-service vendor routing, and wallet-funding approvals.

## 4. External services, tools & platforms

The app's core functionality depends on these providers and platforms:

| Service | Purpose | How it's integrated |
|---|---|---|
| **VTPass** | Fulfils airtime, data, cable TV, electricity, WAEC, and SMS orders | `VTPassProvider` adapter (`VENDOR_PROVIDER=vtpass`), authenticated via `VTPASS_API_KEY`, `VTPASS_SECRET_KEY`, `VTPASS_PUBLIC_KEY` env vars; sandbox `https://sandbox.vtpass.com/api`, live `https://vtpass.com/api` |
| **eBulkSMS** | Bulk SMS delivery (sender-ID campaigns) | `EbulksmsProvider` adapter, `EBULK_USERNAME` + `EBULK_API_KEY` env vars |
| **Pairgate** | Data bundle fulfilment (CG / SME / Gifting / AWOOF) | `PairgateProvider` adapter (`VENDOR_PROVIDER=pairgate` or per-service pin), Bearer auth via `PAIRGATE_API_KEY`; base `https://pairgate.com/api/v1`; switching the DATA routing re-seeds the catalog with Pairgate plans |
| **Monnify** | Wallet funding checkout (card, bank transfer, USSD) | `MONNIFY_*` env vars; hosted checkout + signed webhook at `/api/funding/webhook/monnify` |
| **Paystack** | Wallet funding checkout (alternative gateway) | `PAYSTACK_SECRET_KEY` env var; hosted checkout + signed webhook at `/api/funding/webhook/paystack` |
| **MongoDB Atlas** | Hosted database (replica set enables atomic transactions) | `MONGODB_URI` in `backend/.env` |
| **Vercel** | Hosts the production API backend (`https://smart-cafe-bay.vercel.app`) | Default `EXPO_PUBLIC_API_URL` |
| **SMTP mail service** | Sends password-reset codes | `MailService` via nodemailer (`SMTP_*` / `MAIL_*` env vars) |
| **Expo EAS** | Mobile builds + over-the-air updates | Expo project config (`updates.url`, `eas.projectId` in `mobile/app.json`) |
| **MockProvider** | Local development — simulates vendor success/failure, tokens, PINs | Default (`VENDOR_PROVIDER=mock`); no keys required |

The catalog is **catalog-driven**: all products, prices, and commissions live in the database (seeded by `npm run seed`, manageable in the admin dashboard), so new networks, discos, and bundle sizes can be added without a code deploy.

## 5. Regional availability

SmartCafe is purpose-built for **Nigeria** and its content and features are consistent across all regions where the app is offered:

- **Currency** — the wallet is denominated in **₦ (NGN)** only.
- **Networks** — MTN, Airtel, GLO, and 9mobile airtime/data bundles.
- **Electricity** — 12 Nigerian distribution companies (IKEDC, EKEDC, AEDC, PHED, etc.) with meter verification and token delivery.
- **Cable TV** — DStv, GOtv, and StarTimes with smart-card verification.
- **Education** — WAEC result-checker PINs and exam registration.
- **SMS** — recipient numbers formatted as international `234…` for eBulkSMS; sender-ID campaigns.

There is **no region-dependent feature gating** in the app code: the same features are available on every install, and the product/pricing catalog served by the backend determines what is purchaseable. If the platform were extended to another country, the catalog, currency, provider adapters, and vendor routing would be updated centrally in the backend — the app itself would function identically.

## 6. Regulated industry & third-party material

SmartCafe operates as a **regulated digital-services reseller** in Nigeria. The value-added services (telecom airtime/data, electricity tokens, cable subscriptions, WAEC pins, and bulk SMS) are delivered through **authorised third-party APIs** rather than held or re-sold from stock:

- All services are fulfilled through the operator's merchant accounts with **VTPass** (airtime/data/cable/electricity/WAEC/SMS) and **eBulkSMS** (bulk SMS). WAEC result-checker PINs and exam-registration serials are protected third-party material delivered exclusively through the VTPass authorised-merchant flow.
- Wallet top-ups are processed by **Monnify** and **Paystack** as regulated Nigerian payment service providers.
- The repository does **not** include proof of authorisation to resell these services. `backend/.env.example` ships with development/**sandbox**-style VTPass, eBulkSMS, and Monnify keys purely as a starting point, and its own comments recommend `VENDOR_PROVIDER=mock` (the bundled no-key simulator) for local development. Live credentials must be obtained by the operator under their own agreements with each provider and configured in `backend/.env` before any production use — the merchant agreements with VTPass, eBulkSMS, Monnify, and Paystack are the documentation that demonstrates authorisation to offer these services.
- The seeded demo account and the "hosted backend" `.env.example` configuration are for development/trial use; production deployments must supply their own credentials and comply with the terms of each provider and with Nigerian regulations applicable to the resale of telecommunication services, electricity bill payments, and educational examination materials.