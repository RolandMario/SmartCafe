/**
 * Mirrors backend `computeCashback` so the confirm-screen preview always agrees
 * with what the server actually credits: resellers earn at `resellerCommission`
 * (falling back to the regular `commission` rate), everyone else earns at the
 * regular rate. Returns a 2-decimal naira value.
 */
export function computeCashbackPreview(input: {
  /** Sales amount the percentage is applied to (unit price for per-item cashback). */
  amount: number;
  /** Regular (user) cashback percentage 0–100 configured on the catalog item. */
  commission?: number | null;
  /** Reseller cashback percentage 0–100 — used when the buyer is a reseller. */
  resellerCommission?: number | null;
  /** Buyer's role; resellers earn at the reseller rate. Defaults to a regular user. */
  role?: string | null;
  /** Number of units when cashback is earned per item (e.g. WAEC PINs). Defaults to 1. */
  quantity?: number;
}): number {
  const { amount, commission, resellerCommission, role, quantity = 1 } = input;
  if (!Number.isFinite(amount) || amount <= 0 || quantity <= 0) return 0;

  const rate =
    role === 'reseller' ? resellerCommission ?? commission : commission ?? 0;
  const pct =
    typeof rate === 'number' && Number.isFinite(rate)
      ? Math.max(0, Math.min(100, rate))
      : 0;
  if (pct === 0) return 0;

  const raw = (amount * pct) / 100;
  return Math.round(raw * quantity * 100) / 100;
}