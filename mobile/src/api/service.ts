import { api } from './client';
import {
  AuthTokens,
  ActiveGateway,
  AnalyticsStats,
  CashbackAccountInfo,
  CatalogItem,
  CustomerVerification,
  DedicatedAccount,
  FundingInitResult,
  FundingRecord,
  HistoryEntry,
  PaymentWallet,
  PurchaseResult,
  ServiceType,
  Transaction,
  TransactionStatus,
  User,
  WalletInfo,
} from '../types';

// ---------------- Auth & profile ----------------
export const authApi = {
  register: (data: { name: string; email: string; phone: string; password: string }) =>
    api.post('/auth/register', data).then((r) => r.data as { user: User; tokens: AuthTokens }),
  login: (data: { identifier: string; password: string }) =>
    api.post('/auth/login', data).then((r) => r.data as { user: User; tokens: AuthTokens }),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }).then((r) => r.data as { message: string }),
  resetPassword: (data: { email: string; code: string; newPassword: string }) =>
    api.post('/auth/reset-password', data).then((r) => r.data as { message: string }),
  me: () => api.get('/users/me').then((r) => r.data as User),
  updateProfile: (data: { name?: string; phone?: string }) =>
    api.patch('/users/me', data).then((r) => r.data as User),
  deleteAccount: () =>
    api.delete('/users/me').then((r) => r.data as { message: string }),
};

// ---------------- Transaction PIN ----------------
export const usersApi = {
  pinStatus: () => api.get('/users/pin/status').then((r) => r.data as { hasPin: boolean }),
  setPin: (data: { pin: string; currentPin?: string }) =>
    api.post('/users/pin', data).then((r) => r.data as { hasPin: boolean }),
  verifyPin: (pin: string) =>
    api.post('/users/pin/verify', { pin }).then((r) => r.data as { valid: boolean }),
};

// ---------------- Catalog ----------------
export const catalogApi = {
  list: (service?: ServiceType) =>
    api.get('/catalog', { params: service ? { service } : {} }).then((r) => r.data as CatalogItem[]),
};

// ---------------- Wallet ----------------
export const walletApi = {
  balance: () => api.get('/wallet').then((r) => r.data as WalletInfo),
  ledger: (params: { page?: number; limit?: number } = {}) =>
    api.get('/wallet/ledger', { params }).then((r) => r.data),
  deposit: (amount: number, provider?: 'paystack' | 'cashback', transferReference?: string) =>
    api
      .post('/funding/deposit', {
        amount,
        ...(provider ? { provider } : {}),
        // Cashback funding is paid by bank transfer to the company account — the
        // reference on that transfer is required so admins can match it.
        ...(provider === 'cashback' && transferReference ? { transferReference } : {}),
      })
      .then((r) => r.data as FundingInitResult),
  verifyFunding: (paymentReference: string) =>
    api.get(`/funding/payment/${paymentReference}`).then((r) => r.data as FundingRecord),
  gateways: () =>
    api.get('/funding/gateways').then((r) => r.data as { gateways: ActiveGateway[] }),
  /** Company bank account for Cashback Funding (manual bank-transfer top-ups). */
  cashbackInfo: () =>
    api.get('/funding/cashback-info').then((r) => r.data as CashbackAccountInfo),
  funding: (params: { page?: number; limit?: number } = {}) =>
    api.get('/funding', { params }).then((r) => r.data),
  /** My dedicated virtual account, or null when not created yet. */
  dedicatedAccount: () =>
    api
      .get('/funding/dva')
      .then((r) => r.data as { dedicatedAccount: DedicatedAccount | null }),
  /** Idempotent get-or-create for my dedicated virtual account. */
  createDedicatedAccount: () =>
    api
      .post('/funding/dva')
      .then((r) => r.data as { dedicatedAccount: DedicatedAccount }),
};

// ---------------- Services ----------------
export const serviceApi = {
  airtime: (
    data: { network: string; phone: string; amount: number },
    pin: string,
    wallet?: PaymentWallet,
  ) =>
    api
      .post('/airtime/purchase', { ...data, pin, ...(wallet ? { wallet } : {}) })
      .then((r) => r.data as PurchaseResult),

  data: (data: { planId: string; phone: string }, pin: string, wallet?: PaymentWallet) =>
    api
      .post('/data/purchase', { ...data, pin, ...(wallet ? { wallet } : {}) })
      .then((r) => r.data as PurchaseResult),

  cableVerify: (data: { provider: string; smartCardNumber: string }) =>
    api.post('/cable/verify', data).then((r) => r.data as CustomerVerification),
  cable: (
    data: { provider: string; smartCardNumber: string; packageId: string },
    pin: string,
    wallet?: PaymentWallet,
  ) =>
    api
      .post('/cable/purchase', { ...data, pin, ...(wallet ? { wallet } : {}) })
      .then((r) => r.data as PurchaseResult),

  electricityVerify: (data: { disco: string; meterNumber: string; meterType: string }) =>
    api.post('/electricity/verify', data).then((r) => r.data as CustomerVerification),
  electricity: (
    data: {
      disco: string;
      meterNumber: string;
      meterType: string;
      amount: number;
    },
    pin: string,
    wallet?: PaymentWallet,
  ) =>
    api
      .post('/electricity/purchase', { ...data, pin, ...(wallet ? { wallet } : {}) })
      .then((r) => r.data as PurchaseResult),

  waec: (
    data: {
      productId: string;
      /** Number of PINs to buy (registration only). Defaults to 1. */
      quantity?: number;
    },
    pin: string,
    wallet?: PaymentWallet,
  ) =>
    api
      .post('/waec/purchase', { ...data, pin, ...(wallet ? { wallet } : {}) })
      .then((r) => r.data as PurchaseResult),

  jambVerify: (data: { productId: string; profileId: string }) =>
    api.post('/jamb/verify', data).then((r) => r.data as CustomerVerification),
  jamb: (
    data: { productId: string; profileId: string },
    pin: string,
    wallet?: PaymentWallet,
  ) =>
    api
      .post('/jamb/purchase', { ...data, pin, ...(wallet ? { wallet } : {}) })
      .then((r) => r.data as PurchaseResult),

  smsQuote: (recipients: number, messageLength = 0) =>
    api.get('/sms/quote', { params: { recipients, messageLength } }).then((r) => r.data),
  sms: (
    data: { senderName: string; message: string; recipients: string[] },
    pin: string,
    wallet?: PaymentWallet,
  ) =>
    api
      .post('/sms/purchase', { ...data, pin, ...(wallet ? { wallet } : {}) })
      .then((r) => r.data as PurchaseResult),
};

// ---------------- Transactions ----------------
export const transactionApi = {
  list: (
    params: { page?: number; limit?: number; service?: ServiceType; status?: TransactionStatus } = {},
  ) =>
    api
      .get('/transactions', { params })
      .then((r) => r.data as { items: HistoryEntry[]; total: number; page: number; limit: number }),
  get: (id: string) => api.get(`/transactions/${id}`).then((r) => r.data as Transaction),
  requery: (id: string) => api.post(`/transactions/${id}/requery`).then((r) => r.data),
  /** Purchase analytics per service for the current user. `month` is YYYY-MM; omit for all-time. */
  stats: (month?: string) =>
    api
      .get('/transactions/stats', { params: month ? { month } : {} })
      .then((r) => r.data as AnalyticsStats),
};
