import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { walletApi } from '../api/service';
import { apiErrorMessage } from '../api/client';
import { Screen, Button, Field, Card } from '../components/ui';
import { DvaCard } from '../components/DvaCard';
import { CashbackFundingCard } from '../components/CashbackFundingCard';
import { FundingReceiptModal } from '../components/FundingReceipt';
import { Colors, Font, Spacing } from '../constants/theme';
import { formatNaira } from '../utils/format';
import { useAuthStore } from '../store/auth';
import { ActiveGateway, FundingStatus } from '../types';

const PRESETS = [1000, 5000, 10000, 50000];

const GATEWAY_LABEL: Record<string, string> = {
  paystack: 'Paystack',
  cashback: 'Cashback funding',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll the backend until the payment leaves 'pending' (30 × 3s ≈ 90s). */
async function pollFunding(paymentReference: string): Promise<FundingStatus | null> {
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    try {
      const rec = await walletApi.verifyFunding(paymentReference);
      if (rec.status !== 'pending') return rec.status;
    } catch {
      // transient network error — keep polling
    }
  }
  return null;
}

export default function FundScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [amount, setAmount] = useState('');
  const [activeGateways, setActiveGateways] = useState<ActiveGateway[] | null>(null);
  const [provider, setProvider] = useState<'paystack' | 'cashback' | ''>('');
  const [transferRef, setTransferRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<null | {
    status: FundingStatus;
    reference: string;
    amount: number;
    manual: boolean;
    transferReference?: string;
    createdAt?: string;
  }>(null);

  // Only gateways the platform admin has enabled (and that are configured)
  // should be offered to the user for funding their wallet.
  useEffect(() => {
    let cancelled = false;
    walletApi
      .gateways()
      .then(({ gateways }) => {
        if (cancelled) return;
        setActiveGateways(gateways);
        setProvider(gateways.length > 0 ? gateways[0].provider : '');
      })
      .catch(() => {
        if (cancelled) return;
        setActiveGateways([]);
        setProvider('');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt < 100) {
      setError('Enter an amount of at least ₦100');
      return;
    }
    // Cashback funding is paid by a bank transfer to our company account first —
    // the reference on that transfer is required so we can match it.
    if (provider === 'cashback' && !transferRef.trim()) {
      setError('Enter the transfer reference number from your bank transfer');
      return;
    }
    setError('');
    setLoading(true);
    try {
      // No provider → the backend falls back to the manual admin-approval flow.
      const init = await walletApi.deposit(
        amt,
        provider || undefined,
        provider === 'cashback' ? transferRef.trim() : undefined,
      );

      if (init.checkoutUrl) {
        // Hosted checkout (Paystack) — open in the system browser.
        setPaying(true);
        await WebBrowser.openBrowserAsync(init.checkoutUrl);
        setPaying(false);

        // Confirm the payment server-side (the webhook usually fires first).
        const status = await pollFunding(init.paymentReference);
        void queryClient.invalidateQueries({ queryKey: ['wallet'] });
        setDone({ status: status ?? 'pending', reference: init.paymentReference, amount: amt, manual: false });
      } else {
        // Manual fallback — request goes to admins for approval.
        setDone({
          status: 'pending',
          reference: init.paymentReference,
          amount: amt,
          manual: true,
          transferReference: init.funding?.transferReference,
          createdAt: init.funding?.createdAt,
        });
        // The funding request has no wallet effect yet (admin approval credits
        // it later), but the History feed must list it right away.
        void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      }
      // Refetch the History feed so the new funding request is listed.
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not create funding request'));
    } finally {
      setLoading(false);
      setPaying(false);
    }
  };

  const retry = () => {
    setDone(null);
    setAmount('');
    setTransferRef('');
    setError('');
  };

  const hasGateways = activeGateways !== null && activeGateways.length > 0;

  return (
    <Screen>
      <Text style={styles.title}>Fund Wallet</Text>
      <Text style={styles.muted}>
        Pay by card, bank transfer or USSD via our secure gateway checkout and your wallet is credited instantly.
      </Text>

      {!done ? (
        <Card>
          <View style={styles.presets}>
            {PRESETS.map((v) => (
              <Text
                key={v}
                style={[styles.preset, amount === String(v) && styles.presetActive]}
                onPress={() => setAmount(String(v))}
              >
                {formatNaira(v)}
              </Text>
            ))}
          </View>
          <Text style={styles.muted}>Payment method</Text>
          <View style={styles.providerRow}>
            {activeGateways === null ? (
              <Text style={styles.mutedSmall}>Loading payment options…</Text>
            ) : (
              activeGateways.map((g) => (
                <Text
                  key={g.provider}
                  style={[styles.provider, provider === g.provider && styles.providerActive]}
                  onPress={paying ? undefined : () => setProvider(g.provider)}
                >
                  {GATEWAY_LABEL[g.provider] ?? g.label}
                </Text>
              ))
            )}
            <Text
              key="cashback"
              style={[styles.provider, provider === 'cashback' && styles.providerActive]}
              onPress={paying ? undefined : () => setProvider('cashback')}
            >
              Cashback funding
            </Text>
          </View>
          {activeGateways !== null && activeGateways.length === 0 ? (
            <Text style={styles.mutedSmall}>
              No payment gateway is active right now — you can still pay by Cashback funding or request manual
              approval.
            </Text>
          ) : null}
          <Field
            label="Amount (₦)"
            value={amount}
            onChangeText={setAmount}
            placeholder="e.g. 5000"
            keyboardType="number-pad"
            editable={!paying}
          />
          {provider === 'cashback' ? (
            <>
              <Field
                label="Transfer reference number"
                value={transferRef}
                onChangeText={setTransferRef}
                placeholder="Reference on your bank transfer"
                autoCapitalize="none"
                editable={!paying}
              />
              <Text style={styles.mutedSmall}>
                Only create the request after you have transferred the amount to our company account —
                your reference lets us match and verify the transfer.
              </Text>
            </>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title={
              provider === 'cashback'
                ? 'Create cashback funding request'
                : hasGateways
                  ? `Pay with ${GATEWAY_LABEL[provider ?? ''] ?? 'gateway'}`
                  : 'Request funding approval'
            }
            onPress={submit}
            loading={loading}
            disabled={paying}
          />
        </Card>
      ) : null}

      {/* Bank-transfer funding via the company account (admin-verified). */}
      <CashbackFundingCard />

      {/* Bank-transfer funding via a personal dedicated virtual account. */}
      <DvaCard />

      {paying ? (
        <Card>
          <Text style={styles.payTitle}>Waiting for payment…</Text>
          <Text style={styles.muted}>
            Complete your payment in the browser window that just opened. When you return, we&apos;ll confirm it for you.
          </Text>
        </Card>
      ) : null}

      {done ? (
        !done.manual ? (
          <Card>
            {done.status === 'credited' ? (
              <>
                <Text style={[styles.successTitle, { color: Colors.success }]}>Wallet funded ✅</Text>
                <Text style={styles.muted}>{formatNaira(done.amount)} has been credited to your wallet.</Text>
              </>
            ) : done.status === 'failed' ? (
              <>
                <Text style={[styles.successTitle, { color: Colors.danger }]}>Payment failed</Text>
                <Text style={styles.muted}>Your payment could not be completed. Please try again.</Text>
              </>
            ) : (
              <>
                <Text style={[styles.successTitle, { color: Colors.warning }]}>Payment pending</Text>
                <Text style={styles.muted}>
                  We&apos;re confirming your payment — your wallet will be credited automatically once confirmed.
                </Text>
              </>
            )}
            <View style={styles.refRow}>
              <Text style={styles.mutedSmall}>Reference: {done.reference}</Text>
              <Text style={styles.mutedSmall}>Amount: {formatNaira(done.amount)}</Text>
            </View>
            {done.status === 'failed' ? (
              <Button title="Try again" onPress={retry} />
            ) : (
              <Button title="Go to home" variant="outline" onPress={() => router.replace('/(tabs)')} />
            )}
          </Card>
        ) : (
          // Cashback (bank-transfer) funding — the receipt pops up as a modal
          // over this screen instead of being pushed down the page.
          <FundingReceiptModal
            visible
            data={{
              name: user?.name ?? '',
              phone: user?.phone ?? '',
              amount: done.amount,
              reference: done.reference,
              transferReference: done.transferReference,
              createdAt: done.createdAt,
              status: 'pending',
            }}
            onClose={() => router.replace('/(tabs)')}
          />
        )
      ) : null}

      {!done ? <Button title="Back" variant="ghost" onPress={() => router.back()} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: Font.xl, fontWeight: '800', color: Colors.text },
  muted: { fontSize: Font.sm, color: Colors.textMuted },
  mutedSmall: { fontSize: Font.xs, color: Colors.textMuted },
  error: { color: Colors.danger, fontSize: Font.sm },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  preset: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.textMuted,
    fontWeight: '700',
  },
  presetActive: { backgroundColor: Colors.primarySoft, borderColor: Colors.primary, color: Colors.primaryDark },
  providerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  provider: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.textMuted,
    fontWeight: '700',
  },
  providerActive: { backgroundColor: Colors.primarySoft, borderColor: Colors.primary, color: Colors.primaryDark },
  payTitle: { fontSize: Font.md, fontWeight: '800', color: Colors.text, marginBottom: Spacing.xs },
  successTitle: { fontSize: Font.md, fontWeight: '800', marginBottom: Spacing.xs },
  refRow: { gap: 2, marginVertical: Spacing.md },
});
