export enum Role {
  USER = 'user',
  ADMIN = 'admin',
}

export enum ServiceType {
  AIRTIME = 'AIRTIME',
  DATA = 'DATA',
  CABLE = 'CABLE',
  ELECTRICITY = 'ELECTRICITY',
  WAEC = 'WAEC',
  JAMB = 'JAMB',
  SMS = 'SMS',
}

export enum TransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export enum LedgerType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

/**
 * Which wallet a debit/credit/ledger-entry applies to. The main (fundable,
 * withdrawable) wallet backs every purchase by default; the cashback wallet is
 * only ever topped up by purchase commissions and spent on future purchases.
 */
export enum PaymentWallet {
  MAIN = 'main',
  CASHBACK = 'cashback',
}

export enum FundingStatus {
  PENDING = 'pending',
  CREDITED = 'credited',
  FAILED = 'failed',
}

export enum WaecSubService {
  RESULT_CHECKER = 'RESULT_CHECKER',
  REGISTRATION = 'REGISTRATION',
}

export enum VendorResultStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  PENDING = 'pending',
}