import { create } from 'zustand';
import { PaymentWallet, PurchaseResult, Transaction } from '../types';

export interface ReviewRow {
  label: string;
  value: string;
}

export interface PurchaseDraft {
  title: string;
  subtitle?: string;
  amount: number;
  review: ReviewRow[];
  /** Cashback the user will earn (₦) if this purchase succeeds. 0/absent = none. */
  cashback?: number;
  /** Which wallet funds the purchase; chosen on the confirm screen. */
  wallet: PaymentWallet;
  /** Executes the actual purchase via the matching API. Requires the 4-digit transaction PIN. */
  submit: (pin: string, wallet: PaymentWallet) => Promise<PurchaseResult>;
}

interface PurchaseState {
  draft: PurchaseDraft | null;
  result: PurchaseResult | null;
  error: string | null;
  setDraft: (draft: PurchaseDraft | null) => void;
  setWallet: (wallet: PaymentWallet) => void;
  setResult: (result: PurchaseResult) => void;
  setError: (error: string | null) => void;
  clear: () => void;
}

export const usePurchaseStore = create<PurchaseState>((set, get) => ({
  draft: null,
  result: null,
  error: null,
  setDraft: (draft) => set({ draft, result: null, error: null }),
  setWallet: (wallet) =>
    set((s) => ({ draft: s.draft ? { ...s.draft, wallet } : s.draft })),
  setResult: (result) => set({ result }),
  setError: (error) => set({ error }),
  clear: () => set({ draft: null, result: null, error: null }),
}));

export function isSuccess(transaction?: Transaction): boolean {
  return transaction?.status === 'success';
}
