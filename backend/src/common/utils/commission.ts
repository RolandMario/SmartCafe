import { Role } from '../enums';

export interface ComputeCashbackInput {
  /** Sales amount the percentage is applied to (unit price for per-item cashback). */
  amount: number;
  /** Regular (user) cashback percentage 0–100 configured on the catalog item. */
  commission?: number | null;
  /** Reseller cashback percentage 0–100 — used when the buyer is a reseller. */
  resellerCommission?: number | null;
  /** Buyer's role; resellers earn at the reseller rate. Defaults to a regular user. */
  role?: string;
  /** Number of units when cashback is earned per item (e.g. WAEC PINs). Defaults to 1. */
  quantity?: number;
}

/**
 * Cashback earned on a purchase, derived from percentage commission fields on
 * the catalog item. Resellers earn at the separate `resellerCommission` rate
 * (falling back to the regular rate when it's unset); every other user always
 * earns at the regular rate (`commission`). Zero when no rate applies.
 *
 * Returns a 2-decimal naira value (0 for non-positive amounts/quantities) so
 * the credited cashback and the confirm-screen preview always agree.
 */
export function computeCashback(input: ComputeCashbackInput): number {
  const { amount, commission, resellerCommission, role, quantity = 1 } = input;
  if (!Number.isFinite(amount) || amount <= 0 || quantity <= 0) return 0;

  const rate =
    role === Role.RESELLER ? resellerCommission ?? commission : commission ?? 0;
  const pct =
    typeof rate === 'number' && Number.isFinite(rate)
      ? Math.max(0, Math.min(100, rate))
      : 0;
  if (pct === 0) return 0;

  const raw = (amount * pct) / 100;
  return Math.round(raw * quantity * 100) / 100;
}