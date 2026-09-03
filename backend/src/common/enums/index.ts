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