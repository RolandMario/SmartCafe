export interface SeedItem {
  service: string;
  provider: string;
  providerLabel: string;
  productCode: string;
  name: string;
  amount?: number;
  minAmount?: number;
  maxAmount?: number;
  unitPrice?: number;
  validityDays?: number;
  sortOrder?: number;
}

export const CATALOG_SEED: SeedItem[] = [
  // ---------- Airtime networks ----------
  { service: 'AIRTIME', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn', name: 'MTN Airtime', minAmount: 50, maxAmount: 100000, sortOrder: 1 },
  { service: 'AIRTIME', provider: 'GLO', providerLabel: 'Globacom', productCode: 'glo', name: 'Glo Airtime', minAmount: 50, maxAmount: 100000, sortOrder: 2 },
  { service: 'AIRTIME', provider: 'AIRTEL', providerLabel: 'Airtel Nigeria', productCode: 'airtel', name: 'Airtel Airtime', minAmount: 50, maxAmount: 100000, sortOrder: 3 },
  { service: 'AIRTIME', provider: '9MOBILE', providerLabel: '9mobile', productCode: 'etisalat', name: '9mobile Airtime', minAmount: 50, maxAmount: 100000, sortOrder: 4 },

  // ---------- MTN data bundles (serviceID: mtn-data) ----------
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-10mb-100', name: 'MTN 100MB (24hrs)', amount: 100, validityDays: 1, sortOrder: 1 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-50mb-200', name: 'MTN 200MB (2 days)', amount: 200, validityDays: 2, sortOrder: 2 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-100mb-1000', name: 'MTN 1.5GB (30 days)', amount: 1000, validityDays: 30, sortOrder: 3 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-500mb-2000', name: 'MTN 4.5GB (30 days)', amount: 2000, validityDays: 30, sortOrder: 4 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-20hrs-1500', name: 'MTN 6GB (7 days)', amount: 1500, validityDays: 7, sortOrder: 5 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-3gb-2500', name: 'MTN 6GB (30 days)', amount: 2500, validityDays: 30, sortOrder: 6 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-data-3000', name: 'MTN 8GB (30 days)', amount: 3000, validityDays: 30, sortOrder: 7 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-1gb-3500', name: 'MTN 10GB (30 days)', amount: 3500, validityDays: 30, sortOrder: 8 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-100hr-5000', name: 'MTN 15GB (30 days)', amount: 5000, validityDays: 30, sortOrder: 9 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-3gb-6000', name: 'MTN 20GB (30 days)', amount: 6000, validityDays: 30, sortOrder: 10 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-40gb-10000', name: 'MTN 40GB (30 days)', amount: 10000, validityDays: 30, sortOrder: 11 },
  { service: 'DATA', provider: 'MTN', providerLabel: 'MTN Nigeria', productCode: 'mtn-75gb-15000', name: 'MTN 75GB (30 days)', amount: 15000, validityDays: 30, sortOrder: 12 },

  // ---------- GLO data bundles (serviceID: glo-data) ----------
  { service: 'DATA', provider: 'GLO', providerLabel: 'Globacom', productCode: 'glo100', name: 'GLO 105MB (2 days)', amount: 100, validityDays: 2, sortOrder: 1 },
  { service: 'DATA', provider: 'GLO', providerLabel: 'Globacom', productCode: 'glo200', name: 'GLO 350MB (4 days)', amount: 200, validityDays: 4, sortOrder: 2 },
  { service: 'DATA', provider: 'GLO', providerLabel: 'Globacom', productCode: 'glo500', name: 'GLO 1.05GB (14 days)', amount: 500, validityDays: 14, sortOrder: 3 },
  { service: 'DATA', provider: 'GLO', providerLabel: 'Globacom', productCode: 'glo1000', name: 'GLO 2.5GB (30 days)', amount: 1000, validityDays: 30, sortOrder: 4 },
  { service: 'DATA', provider: 'GLO', providerLabel: 'Globacom', productCode: 'glo2000', name: 'GLO 5.8GB (30 days)', amount: 2000, validityDays: 30, sortOrder: 5 },
  { service: 'DATA', provider: 'GLO', providerLabel: 'Globacom', productCode: 'glo3000', name: 'GLO 10GB (30 days)', amount: 3000, validityDays: 30, sortOrder: 6 },
  { service: 'DATA', provider: 'GLO', providerLabel: 'Globacom', productCode: 'glo5000', name: 'GLO 18.25GB (30 days)', amount: 5000, validityDays: 30, sortOrder: 7 },

  // ---------- Airtel data bundles (serviceID: airtel-data) ----------
  { service: 'DATA', provider: 'AIRTEL', providerLabel: 'Airtel Nigeria', productCode: 'airt-100', name: 'Airtel 75MB (1 day)', amount: 99, validityDays: 1, sortOrder: 1 },
  { service: 'DATA', provider: 'AIRTEL', providerLabel: 'Airtel Nigeria', productCode: 'airt-200', name: 'Airtel 200MB (3 days)', amount: 199.03, validityDays: 3, sortOrder: 2 },
  { service: 'DATA', provider: 'AIRTEL', providerLabel: 'Airtel Nigeria', productCode: 'airt-300', name: 'Airtel 350MB (7 days)', amount: 299.02, validityDays: 7, sortOrder: 3 },
  { service: 'DATA', provider: 'AIRTEL', providerLabel: 'Airtel Nigeria', productCode: 'airt-500', name: 'Airtel 750MB (14 days)', amount: 499, validityDays: 14, sortOrder: 4 },
  { service: 'DATA', provider: 'AIRTEL', providerLabel: 'Airtel Nigeria', productCode: 'airt-1000', name: 'Airtel 1.5GB (30 days)', amount: 999, validityDays: 30, sortOrder: 5 },
  { service: 'DATA', provider: 'AIRTEL', providerLabel: 'Airtel Nigeria', productCode: 'airt-2000', name: 'Airtel 4.5GB (30 days)', amount: 1999, validityDays: 30, sortOrder: 6 },
  { service: 'DATA', provider: 'AIRTEL', providerLabel: 'Airtel Nigeria', productCode: 'airt-3000', name: 'Airtel 8GB (30 days)', amount: 2999.02, validityDays: 30, sortOrder: 7 },
  { service: 'DATA', provider: 'AIRTEL', providerLabel: 'Airtel Nigeria', productCode: 'airt-4000', name: 'Airtel 11GB (30 days)', amount: 3999.01, validityDays: 30, sortOrder: 8 },

  // ---------- 9mobile data bundles (serviceID: etisalat-data) ----------
  { service: 'DATA', provider: '9MOBILE', providerLabel: '9mobile', productCode: 'eti-100', name: '9mobile 100MB (1 day)', amount: 100, validityDays: 1, sortOrder: 1 },
  { service: 'DATA', provider: '9MOBILE', providerLabel: '9mobile', productCode: 'eti-200', name: '9mobile 650MB (1 day)', amount: 200, validityDays: 1, sortOrder: 2 },
  { service: 'DATA', provider: '9MOBILE', providerLabel: '9mobile', productCode: 'eti-300', name: '9mobile 1GB + 100MB (1 day)', amount: 300, validityDays: 1, sortOrder: 3 },
  { service: 'DATA', provider: '9MOBILE', providerLabel: '9mobile', productCode: 'eti-500', name: '9mobile 500MB (30 days)', amount: 500, validityDays: 30, sortOrder: 4 },
  { service: 'DATA', provider: '9MOBILE', providerLabel: '9mobile', productCode: 'eti-1000', name: '9mobile 1.5GB (30 days)', amount: 1000, validityDays: 30, sortOrder: 5 },
  { service: 'DATA', provider: '9MOBILE', providerLabel: '9mobile', productCode: 'eti-2000', name: '9mobile 4.5GB (30 days)', amount: 2000, validityDays: 30, sortOrder: 6 },
  { service: 'DATA', provider: '9MOBILE', providerLabel: '9mobile', productCode: 'eti-5000', name: '9mobile 15GB (30 days)', amount: 5000, validityDays: 30, sortOrder: 7 },


  // ---------- Cable TV ----------
  { service: 'CABLE', provider: 'DSTV', providerLabel: 'DStv', productCode: 'dstv-padi', name: 'DStv Padi', amount: 3150, sortOrder: 1 },
  { service: 'CABLE', provider: 'DSTV', providerLabel: 'DStv', productCode: 'dstv-yanga', name: 'DStv Yanga', amount: 5000, sortOrder: 2 },
  { service: 'CABLE', provider: 'DSTV', providerLabel: 'DStv', productCode: 'dstv-confam', name: 'DStv Confam', amount: 7000, sortOrder: 3 },
  { service: 'CABLE', provider: 'DSTV', providerLabel: 'DStv', productCode: 'dstv-compact', name: 'DStv Compact', amount: 9000, sortOrder: 4 },
  { service: 'CABLE', provider: 'DSTV', providerLabel: 'DStv', productCode: 'dstv-compactplus', name: 'DStv Compact Plus', amount: 15000, sortOrder: 5 },
  { service: 'CABLE', provider: 'DSTV', providerLabel: 'DStv', productCode: 'dstv-premium', name: 'DStv Premium', amount: 21000, sortOrder: 6 },
  { service: 'CABLE', provider: 'GOTV', providerLabel: 'GOtv', productCode: 'gotv-smallie', name: 'GOtv Smallie', amount: 2000, sortOrder: 1 },
  { service: 'CABLE', provider: 'GOTV', providerLabel: 'GOtv', productCode: 'gotv-jinja', name: 'GOtv Jinja', amount: 3000, sortOrder: 2 },
  { service: 'CABLE', provider: 'GOTV', providerLabel: 'GOtv', productCode: 'gotv-jolli', name: 'GOtv Jolli', amount: 4000, sortOrder: 3 },
  { service: 'CABLE', provider: 'GOTV', providerLabel: 'GOtv', productCode: 'gotv-max', name: 'GOtv Max', amount: 5000, sortOrder: 4 },
  { service: 'CABLE', provider: 'STARTIMES', providerLabel: 'StarTimes', productCode: 'startimes-nova', name: 'StarTimes Nova', amount: 1300, sortOrder: 1 },
  { service: 'CABLE', provider: 'STARTIMES', providerLabel: 'StarTimes', productCode: 'startimes-basic', name: 'StarTimes Basic', amount: 2000, sortOrder: 2 },
  { service: 'CABLE', provider: 'STARTIMES', providerLabel: 'StarTimes', productCode: 'startimes-classic', name: 'StarTimes Classic', amount: 3500, sortOrder: 3 },
  { service: 'CABLE', provider: 'STARTIMES', providerLabel: 'StarTimes', productCode: 'startimes-asia', name: 'StarTimes Asia', amount: 4500, sortOrder: 4 },

  // ---------- Electricity Discos (provider/productCode = VTPass serviceID) ----------
  { service: 'ELECTRICITY', provider: 'ikeja-electric', providerLabel: 'Ikeja Electric (IKEDC)', productCode: 'ikeja-electric', name: 'IKEDC Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 1 },
  { service: 'ELECTRICITY', provider: 'eko-electric', providerLabel: 'Eko Electric (EKEDC)', productCode: 'eko-electric', name: 'EKEDC Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 2 },
  { service: 'ELECTRICITY', provider: 'abuja-electric', providerLabel: 'Abuja Electric (AEDC)', productCode: 'abuja-electric', name: 'AEDC Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 3 },
  { service: 'ELECTRICITY', provider: 'portharcourt-electric', providerLabel: 'Port Harcourt Electric (PHED)', productCode: 'portharcourt-electric', name: 'PHED Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 4 },
  { service: 'ELECTRICITY', provider: 'ibadan-electric', providerLabel: 'Ibadan Electric (IBEDC)', productCode: 'ibadan-electric', name: 'IBEDC Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 5 },
  { service: 'ELECTRICITY', provider: 'enugu-electric', providerLabel: 'Enugu Electric (EEDC)', productCode: 'enugu-electric', name: 'EEDC Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 6 },
  { service: 'ELECTRICITY', provider: 'kaduna-electric', providerLabel: 'Kaduna Electric (KAEDCO)', productCode: 'kaduna-electric', name: 'KAEDCO Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 7 },
  { service: 'ELECTRICITY', provider: 'kano-electric', providerLabel: 'Kano Electric (KEDCO)', productCode: 'kano-electric', name: 'KEDCO Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 8 },
  { service: 'ELECTRICITY', provider: 'jos-electric', providerLabel: 'Jos Electric (JED)', productCode: 'jos-electric', name: 'JED Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 9 },
  { service: 'ELECTRICITY', provider: 'benin-electric', providerLabel: 'Benin Electric (BEDC)', productCode: 'benin-electric', name: 'BEDC Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 10 },
  { service: 'ELECTRICITY', provider: 'aba-electric', providerLabel: 'Aba Electric (APLE)', productCode: 'aba-electric', name: 'APLE Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 11 },
  { service: 'ELECTRICITY', provider: 'yola-electric', providerLabel: 'Yola Electric (YEDC)', productCode: 'yola-electric', name: 'YEDC Prepaid / Postpaid', minAmount: 500, maxAmount: 1000000, sortOrder: 12 },

  // ---------- WAEC ----------
  // amounts mirror VTPass variation_amount (waec -> waecdirect = 900, waec-registration -> waec-registraion = 14450).
  // The seed re-syncs these against VTPass live at runtime (syncWaecPricing in seed.ts), so keep them in sync.
  { service: 'WAEC', provider: 'WAEC', providerLabel: 'WAEC', productCode: 'waec-result-checker', name: 'WAEC Result Checker PIN', amount: 900, sortOrder: 1 },
  { service: 'WAEC', provider: 'WAEC', providerLabel: 'WAEC', productCode: 'waec-registration', name: 'WAEC Registration (Full)', amount: 14450, sortOrder: 2 },

  // ---------- JAMB PIN Vending (serviceID: jamb) ----------
  // amounts mirror VTPass variation_amount (utme-mock = 7700, utme-no-mock = 6200).
  // The seed re-syncs these against VTPass live at runtime (syncJambPricing in seed.ts), so keep them in sync.
  { service: 'JAMB', provider: 'JAMB', providerLabel: 'JAMB', productCode: 'utme-mock', name: 'UTME PIN (with mock)', amount: 7700, sortOrder: 1 },
  { service: 'JAMB', provider: 'JAMB', providerLabel: 'JAMB', productCode: 'utme-no-mock', name: 'UTME PIN (without mock)', amount: 6200, sortOrder: 2 },

  // ---------- Bulk SMS ----------
  { service: 'SMS', provider: 'VTPASS', providerLabel: 'VTPass Messaging', productCode: 'bulk-sms', name: 'Bulk SMS (sender ID)', unitPrice: 2.5, minAmount: 1, maxAmount: 10000, sortOrder: 1 },
];

