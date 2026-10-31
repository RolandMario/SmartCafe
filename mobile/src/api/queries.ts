import { useQuery } from '@tanstack/react-query';
import { catalogApi, walletApi, transactionApi, serviceApi, usersApi } from './service';
import { ServiceType, TransactionStatus } from '../types';

export function useBalance() {
  return useQuery({ queryKey: ['wallet', 'balance'], queryFn: walletApi.balance });
}

export function usePinStatus() {
  return useQuery({
    queryKey: ['pin', 'status'],
    queryFn: usersApi.pinStatus,
    staleTime: 60000,
  });
}

export function useLedger(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['wallet', 'ledger', page],
    queryFn: () => walletApi.ledger({ page, limit }),
  });
}

/**
 * The user's dedicated virtual account (bank-transfer funding). The backend
 * re-checks pending accounts against the provider on each read, so refreshing
 * eventually returns a ready account number even without a webhook delivery.
 */
export function useDedicatedAccount() {
  return useQuery({
    queryKey: ['funding', 'dva'],
    queryFn: walletApi.dedicatedAccount,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

export function useCatalog(service?: ServiceType) {
  return useQuery({
    queryKey: ['catalog', service ?? 'all'],
    queryFn: () => catalogApi.list(service),
    // The catalog is vendor-driven and can be re-seeded when the admin changes
    // the DATA provider (e.g. vtpass -> pairgate) — never serve it stale, and
    // refetch whenever the app regains focus so a backend switch shows up.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

export function useTransactions(params: {
  page?: number;
  limit?: number;
  service?: ServiceType;
  status?: TransactionStatus;
} = {}) {
  return useQuery({
    queryKey: ['transactions', params],
    queryFn: () => transactionApi.list(params),
  });
}

export function useTransaction(id: string) {
  return useQuery({
    queryKey: ['transactions', id],
    queryFn: () => transactionApi.get(id),
    enabled: !!id,
  });
}

/**
 * Purchase analytics per service for the current user. `month` is YYYY-MM
 * (or undefined for all-time). Refetches on focus so fresh purchases show up.
 */
export function useAnalytics(month?: string) {
  return useQuery({
    queryKey: ['transactions', 'stats', month ?? 'all'],
    queryFn: () => transactionApi.stats(month),
    refetchOnWindowFocus: true,
  });
}

export function useSmsQuote(recipients: number, messageLength = 0) {
  return useQuery({
    queryKey: ['sms', 'quote', recipients, messageLength],
    queryFn: () => serviceApi.smsQuote(recipients, messageLength),
    enabled: recipients > 0,
  });
}
