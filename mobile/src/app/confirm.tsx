import { useCallback, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { usePurchaseStore } from '../store/purchase';
import { usePinStatus, useBalance } from '../api/queries';
import { apiErrorMessage } from '../api/client';
import { Screen, Button, Card } from '../components/ui';
import { PinModal } from '../components/PinModal';
import { Colors, Font, Radius, Spacing } from '../constants/theme';
import { formatNaira } from '../utils/format';

/** Selectable wallet option card on the confirm screen. */
function WalletOption({
  label,
  value,
  selected,
  onSelect,
}: {
  label: string;
  value: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={[styles.walletOption, selected && styles.walletOptionSelected]}
    >
      <View style={[styles.walletRadio, selected && styles.walletRadioSelected]}>
        {selected ? <View style={styles.walletRadioDot} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.walletOptionLabel, selected && styles.walletOptionLabelSelected]}>
          {label}
        </Text>
        <Text style={styles.walletOptionValue}>{value}</Text>
      </View>
    </Pressable>
  );
}

export default function ConfirmScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const draft = usePurchaseStore((s) => s.draft);
  const wallet = usePurchaseStore((s) => s.draft?.wallet ?? 'main');
  const setWallet = usePurchaseStore((s) => s.setWallet);
  const error = usePurchaseStore((s) => s.error);
  const setResult = usePurchaseStore((s) => s.setResult);
  const setError = usePurchaseStore((s) => s.setError);
  const [loading, setLoading] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const { data: pinStatus, isLoading: pinStatusLoading } = usePinStatus();
  const { data: balance } = useBalance();
  const hasPin = pinStatus?.hasPin ?? false;
  const mainBalance = balance?.balance ?? 0;
  const cashbackBalance = balance?.cashbackBalance ?? 0;

  // Refresh PIN status whenever the screen regains focus (e.g. after setting a PIN).
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ['pin', 'status'] });
    }, [queryClient]),
  );

  if (!draft) {
    return (
      <Screen>
        <Text style={styles.empty}>Nothing to confirm. Please start a purchase.</Text>
        <Button title="Go back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const openPinModal = () => {
    setError(null);
    // Client-side guard mirrors the server: never ask for a PIN we can't pay.
    const available = wallet === 'cashback' ? cashbackBalance : mainBalance;
    if (available < draft.amount) {
      setError(
        wallet === 'cashback'
          ? `Your cashback balance (${formatNaira(cashbackBalance)}) is not enough to cover this purchase.`
          : `Your wallet balance (${formatNaira(mainBalance)}) is not enough to cover this purchase.`,
      );
      return;
    }
    setPinModalVisible(true);
  };

  const pay = async (pin: string) => {
    setError(null);
    setLoading(true);
    try {
      const result = await draft.submit(pin, wallet);
      setPinModalVisible(false);
      setResult(result);
      router.replace('/receipt');
    } catch (e) {
      setError(apiErrorMessage(e, 'Payment failed'));
      // A failed purchase (e.g. the plan was pruned by a provider switch)
      // usually means the bundle list changed — drop the cached catalog so
      // the data screen refetches the current plans.
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
      setLoading(false);
    }
  };

  return (
    <>
      <Screen>
        <Text style={styles.title}>Confirm payment</Text>
        <Text style={styles.subtitle}>{draft.title}</Text>
        {draft.subtitle ? <Text style={styles.muted}>{draft.subtitle}</Text> : null}

        <Card>
          {draft.review.map((r) => (
            <View key={r.label} style={styles.row}>
              <Text style={styles.rowLabel}>{r.label}</Text>
              <Text style={styles.rowValue}>{r.value}</Text>
            </View>
          ))}
          <View style={[styles.row, styles.total]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatNaira(draft.amount)}</Text>
          </View>
        </Card>

        {/* Pay-from wallet switcher — main wallet (funded) or earned cashback. */}
        <Card style={styles.walletCard}>
          <Text style={styles.walletTitle}>Pay from</Text>
          <View style={styles.walletRow}>
            <WalletOption
              label="Main wallet"
              value={formatNaira(mainBalance)}
              selected={wallet === 'main'}
              onSelect={() => setWallet('main')}
            />
            <WalletOption
              label="Cashback"
              value={formatNaira(cashbackBalance)}
              selected={wallet === 'cashback'}
              onSelect={() => setWallet('cashback')}
            />
          </View>
          {wallet === 'cashback' ? (
            <Text style={styles.walletHint}>
              Cashback is earned on successful purchases. It can only be spent on purchases here —
              it cannot be withdrawn.
            </Text>
          ) : null}
        </Card>

        {typeof draft.cashback === 'number' && draft.cashback > 0 ? (
          <View style={styles.cashbackNote}>
            <Text style={styles.cashbackNoteText}>
              🎉 You&apos;ll earn{' '}
              <Text style={styles.cashbackStrong}>{formatNaira(draft.cashback)}</Text> cashback when
              this purchase succeeds.
            </Text>
          </View>
        ) : null}

        {!hasPin && !pinStatusLoading ? (
          <Card style={styles.pinNotice}>
            <Text style={styles.pinNoticeTitle}>Transaction PIN required</Text>
            <Text style={styles.muted}>
              For your security, you must create a 4-digit transaction PIN before sending this
              payment. It will be requested for every transaction.
            </Text>
            <Button title="Set up transaction PIN" variant="outline" onPress={() => router.push('/pin')} />
          </Card>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title={`Pay ${formatNaira(draft.amount)}`}
          onPress={openPinModal}
          loading={loading}
          disabled={!hasPin}
        />
        <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      </Screen>

      {/* Sibling of <Screen/> (not inside its ScrollView) so the overlay can
          cover the full viewport and the PIN keypad comes up reliably. Mounted
          only while open so the pin input starts fresh each time. */}
      {pinModalVisible ? (
        <PinModal
          visible={pinModalVisible}
          title={draft.title}
          amount={draft.amount}
          error={error}
          loading={loading}
          onClose={() => {
            setPinModalVisible(false);
            setError(null);
          }}
          onConfirm={pay}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: Font.xl, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: Font.md, fontWeight: '600', color: Colors.primary },
  muted: { fontSize: Font.sm, color: Colors.textMuted },
  empty: { fontSize: Font.sm, color: Colors.textMuted },
  error: { color: Colors.danger, fontSize: Font.sm },
  pinNotice: { gap: Spacing.sm },
  pinNoticeTitle: { fontSize: Font.md, fontWeight: '800', color: Colors.text },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowLabel: { color: Colors.textMuted, fontSize: Font.sm, flex: 1 },
  rowValue: { color: Colors.text, fontSize: Font.sm, fontWeight: '600', flex: 1, textAlign: 'right' },
  total: { borderBottomWidth: 0, marginTop: Spacing.sm },
  totalLabel: { fontSize: Font.md, fontWeight: '800', color: Colors.text },
  totalValue: { fontSize: Font.md, fontWeight: '800', color: Colors.primary },
  // Wallet switcher
  walletCard: { gap: Spacing.sm },
  walletTitle: { fontSize: Font.md, fontWeight: '800', color: Colors.text },
  walletRow: { flexDirection: 'row', gap: Spacing.sm },
  walletOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  walletOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  walletRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletRadioSelected: { borderColor: Colors.primary },
  walletRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  walletOptionLabel: { fontSize: Font.sm, fontWeight: '700', color: Colors.textMuted },
  walletOptionLabelSelected: { color: Colors.primaryDark },
  walletOptionValue: { fontSize: Font.sm, fontWeight: '800', color: Colors.text, marginTop: 2 },
  walletHint: { fontSize: Font.xs, color: Colors.textMuted },
  // Cashback-earned callout
  cashbackNote: {
    backgroundColor: Colors.successSoft,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  cashbackNoteText: { fontSize: Font.sm, color: Colors.text },
  cashbackStrong: { fontWeight: '800', color: Colors.success },
});
