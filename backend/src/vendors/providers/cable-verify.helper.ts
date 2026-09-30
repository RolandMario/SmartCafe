import { CableCurrentPlan } from '../vendor-provider.interface';
import { cleanCablePlanName } from '../../catalog/cable-plan-sync';

/** First non-empty string among candidate vendor fields (skips null/undefined/'0'). */
export function firstValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text && text !== '0') return text;
  }
  return undefined;
}

/** Parse a positive finite number out of a vendor field. */
export function toNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

/** VTPass reports an unknown current bouquet as "UNKNOWN" / "N/A" / "-" — treat as missing. */
function isUnknownCode(value: unknown): boolean {
  if (value == null) return true;
  const text = String(value).trim();
  if (!text) return true;
  return /^(unknown|na|n\/a|-)$/i.test(text);
}

/**
 * Map a VTPass `/merchant-verify` cable payload onto a single CableCurrentPlan.
 *
 * VTPass does NOT return one canonical shape — it differs by brand and by
 * account status, so every variant is read defensively:
 *   - DSTV flat (older):        Product_Code / Product_Name / Due_Date / Renewal_Amount
 *   - DSTV/GOTV flat (LIVE):    Current_Bouquet / Current_Bouquet_Code /
 *                               Current_Bouquet_Price / Due_Date (or DUE_DATE) /
 *                               Renewal_Amount   ← the shape VTPass actually returns
 *   - StarTimes:                Package_Code / Package_Name / Due_Date / Renewal_Amount
 *   - GOTV/StarTimes nested:    current_product / active_products / products[]
 *
 * A card that has never been subscribed (or that reports no bouquet at all)
 * returns nothing usable → null (the client then falls back to its plan grid).
 */
export function normalizeCablePlan(content: Record<string, any>): CableCurrentPlan | null {
  const currentProduct = content?.current_product ?? content?.currentProduct ?? {};
  const activeProduct =
    (Array.isArray(content?.active_products) && content?.active_products[0]) ||
    (Array.isArray(content?.products) && content?.products[0]) ||
    {};
  const plan =
    currentProduct &&
    (currentProduct?.name || currentProduct?.product || currentProduct?.productName)
      ? currentProduct
      : activeProduct;

  const productCode = firstValue(
    // flat live DSTV/GOTV shape
    content?.Current_Bouquet_Code,
    content?.currentBouquetCode,
    // flat DSTV shape
    content?.Product_Code,
    content?.productCode,
    // StarTimes shape
    content?.Package_Code,
    content?.packageCode,
    // nested GOTV / StarTimes shape
    currentProduct?.productCode,
    currentProduct?.product_code,
    activeProduct?.productCode,
    activeProduct?.product_code,
    plan?.productCode,
    plan?.product_code,
  );

  const nameRaw = firstValue(
    content?.Current_Bouquet,
    content?.currentBouquet,
    content?.Product_Name,
    content?.productName,
    content?.currentProductName,
    content?.Package_Name,
    content?.packageName,
    currentProduct?.productName,
    currentProduct?.product,
    currentProduct?.name,
    activeProduct?.productName,
    activeProduct?.name,
    activeProduct?.product,
    plan?.productName,
    plan?.name,
    plan?.product,
  );

  const dueDate = firstValue(
    content?.Due_Date,
    content?.DUE_DATE,
    content?.dueDate,
    content?.due_date,
    currentProduct?.dueDate,
    currentProduct?.due_date,
    activeProduct?.dueDate,
    activeProduct?.due_date,
    plan?.dueDate,
    plan?.due_date,
  );

  const amount =
    toNumber(content?.Renewal_Amount) ??
    toNumber(content?.renewalAmount) ??
    toNumber(content?.Current_Bouquet_Price) ??
    toNumber(content?.currentBouquetPrice) ??
    toNumber(content?.Package_Price) ??
    toNumber(content?.packagePrice) ??
    toNumber(content?.Minimum_Amount) ??
    toNumber(currentProduct?.price) ??
    toNumber(currentProduct?.amount) ??
    toNumber(activeProduct?.price) ??
    toNumber(activeProduct?.amount) ??
    toNumber(plan?.price) ??
    toNumber(plan?.amount);

  // Normalise the code ("UNKNOWN" is VTPass's way of saying "no bouquet found")
  // so a card with only an unknown code doesn't masquerade as a real plan.
  const code = isUnknownCode(productCode) ? undefined : productCode;
  if (!nameRaw && !code) return null;

  return {
    productCode: code,
    name: (nameRaw ? cleanCablePlanName(nameRaw) : '') || code || 'Unknown plan',
    dueDate,
    amount,
  };
}
