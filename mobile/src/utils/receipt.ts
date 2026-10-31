import { Transaction } from '../types';
import { SERVICE_BY_TYPE } from '../constants/services';
import { formatNaira, formatDate } from './format';

export interface ReceiptRow {
  label: string;
  value: string;
  strong?: boolean;
}

export interface ReceiptTextMeta {
  userName?: string;
  phone?: string;
  walletAfter?: number;
}

function line(label: string, value?: string): string {
  return value ? `${label}: ${value}` : '';
}

/**
 * Builds the receipt rows for a transaction. Shared by the plain-text and PDF
 * renditions so the two never drift apart.
 */
export function collectReceiptRows(
  txn: Transaction,
  meta: ReceiptTextMeta = {},
): { main: ReceiptRow[]; provider: ReceiptRow[] } {
  const svc = SERVICE_BY_TYPE[txn.service];
  const pm = txn.providerMeta ?? {};

  const status =
    txn.status === 'success' ? 'SUCCESSFUL' : txn.status === 'pending' ? 'PROCESSING' : 'FAILED';

  const main: ReceiptRow[] = [
    { label: 'Status', value: status },
    ...(meta.userName ? [{ label: 'User name', value: meta.userName }] : []),
    { label: 'Service', value: svc?.label ?? txn.service },
    { label: 'Reference', value: txn.reference },
    { label: 'Amount paid', value: formatNaira(txn.amount), strong: true },
    // Cashback spent to fund this purchase (payment came from the cashback wallet).
    ...(txn.paymentWallet === 'cashback'
      ? [{ label: 'Cashback used', value: formatNaira(txn.amount) }]
      : []),
    // Cashback earned once the purchase settled successfully.
    ...(txn.status === 'success' && (txn.cashback ?? 0) > 0
      ? [{ label: 'Cashback earned', value: formatNaira(txn.cashback ?? 0) }]
      : []),
    { label: 'Date', value: formatDate(txn.createdAt) },
    ...(meta.phone ? [{ label: 'Phone number', value: meta.phone }] : []),
    ...(meta.walletAfter != null
      ? [{ label: 'Wallet balance after', value: formatNaira(meta.walletAfter) }]
      : []),
  ];

  const provider: ReceiptRow[] = [];

  // Service-specific fields straight from the API/vendor response: cable shows
  // product name + phone; electricity shows product name, customer name,
  // customer address and token; JAMB shows product/profile + PIN; WAEC shows
  // PIN/serial or registration PINs.
  if (txn.service === 'CABLE') {
    const cableProduct = pm.productName ?? txn.meta?.plan;
    if (cableProduct) provider.push({ label: 'Product', value: String(cableProduct) });
    const cablePhone = pm.phone ?? txn.meta?.phone;
    if (cablePhone) provider.push({ label: 'Phone', value: String(cablePhone) });
    if (pm.customerName) provider.push({ label: 'Customer name', value: String(pm.customerName) });
  } else if (txn.service === 'ELECTRICITY') {
    const electricityProduct = pm.productName ?? txn.meta?.discoLabel;
    if (electricityProduct) provider.push({ label: 'Product', value: String(electricityProduct) });
    if (pm.customerName) provider.push({ label: 'Customer name', value: String(pm.customerName) });
    const customerAddress = pm.customerAddress ?? pm.address;
    if (customerAddress) provider.push({ label: 'Customer address', value: String(customerAddress) });
    const mainToken = pm.mainToken ?? pm.token;
    if (mainToken) provider.push({ label: 'ELECTRICITY TOKEN', value: String(mainToken) });
    if (pm.bonusToken) provider.push({ label: 'Bonus token', value: String(pm.bonusToken) });
    if (pm.balanceToken) provider.push({ label: 'Balance token', value: String(pm.balanceToken) });
    if (pm.units != null) provider.push({ label: 'Units purchased', value: String(pm.units) });
  } else if (txn.service === 'JAMB') {
    const jambProduct = pm.productName ?? txn.meta?.product;
    if (jambProduct) provider.push({ label: 'Product', value: String(jambProduct) });
    const profileId = pm.profileId ?? txn.meta?.profileId;
    if (profileId) provider.push({ label: 'Profile ID', value: String(profileId) });
    if (pm.pin) provider.push({ label: 'JAMB PIN', value: String(pm.pin) });
  } else {
    if (pm.quantity != null && Number(pm.quantity) > 1) {
      provider.push({ label: 'Quantity', value: `${pm.quantity} PINs` });
    }
    if (pm.pin) {
      provider.push({ label: 'WAEC PIN', value: String(pm.pin) });
      if (pm.serial) provider.push({ label: 'Serial', value: String(pm.serial) });
    }
    if (Array.isArray(pm.pins)) {
      (pm.pins as string[]).forEach((p, i) =>
        provider.push({ label: i === 0 ? 'REGISTRATION PIN' : '', value: p }),
      );
      if (pm.candidateName) provider.push({ label: 'Candidate', value: String(pm.candidateName) });
    }
    if (pm.customerName && !pm.pin && !pm.pins) {
      provider.push({ label: 'Recipient', value: String(pm.customerName) });
    }
    if (txn.meta?.phone) provider.push({ label: 'Recipient phone', value: String(txn.meta.phone) });
  }

  if (txn.meta?.providerLabel) provider.push({ label: 'Provider', value: String(txn.meta.providerLabel) });
  if (txn.meta?.smartCardNumber) provider.push({ label: 'Smart card', value: String(txn.meta.smartCardNumber) });
  if (txn.meta?.meterNumber) provider.push({ label: 'Meter', value: String(txn.meta.meterNumber) });
  if (txn.failureReason) provider.push({ label: 'Reason', value: txn.failureReason });

  return { main, provider };
}

/**
 * Plain-text rendition of a transaction, used by the native share fallback so
 * the receipt can still be sent via email, WhatsApp, SMS etc.
 */
export function buildReceiptText(txn: Transaction, meta: ReceiptTextMeta = {}): string {
  const { main, provider } = collectReceiptRows(txn, meta);
  const total = (txn.amount ?? 0) + (txn.commission ?? 0);

  const rows = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '      SMARTCAFE · OFFICIAL RECEIPT',
    '   Virtual Top-Up & Bills Payment',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    ...main.map((r) => line(r.label, r.value)),
    ...(provider.length ? ['', ...provider.map((r) => line(r.label, r.value))] : []),
    '',
    line('Total', formatNaira(total)),
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Thank you for using SmartCafe.',
  ];

  return rows.join('\n');
}