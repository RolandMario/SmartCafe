import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useDedicatedAccount } from '../api/queries';
import { walletApi } from '../api/service';
import { apiErrorMessage } from '../api/client';
import { Button, Card } from './ui';
import { Colors, Font, Radius, Spacing } from '../constants/theme';

const POLL_MS = 15000;

/** Group a 10-digit NUBAN into 4-3-3 for readability. */
function groupNumber(num: string) {
  const digits = num.replace(/\D/g, '');
  return digits.length === 10
    ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
    : num;
}

/**
 * Dedicated Virtual Account card (Paystack). Lets the user create a personal
 * bank-account number for wallet top-ups by transfer; `pending` accounts are
 * re-checked every 15 s until the bank provisions a number (`active`).
 */
export function DvaCard() {
  const queryClient = useQueryClient();
  const dvaQuery = useDedicatedAccount();
  const dva = dvaQuery.data?.dedicatedAccount;
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the transient "Copied" feedback timer when the card unmounts.
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const copyNumber = async () => {
    if (!dva?.accountNumber) return;
    try {
      await Clipboard.setStringAsync(dva.accountNumber);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Some web browsers reject clipboard writes outside a user gesture — ignore.
    }
  };

  // While the bank provisions the account asynchronously keep refreshing — the
  // backend re-checks the provider on every read and flips the row to active.
  useEffect(() => {
    if (dva?.status !== 'pending') return;
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['funding', 'dva'] });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [dva?.status, queryClient]);

  const create = async () => {
    setError('');
    setCreating(true);
    try {
      // Idempotent — safe to re-tap; a duplicate simply returns the stored row.
      const { dedicatedAccount: created } = await walletApi.createDedicatedAccount();
      void queryClient.invalidateQueries({ queryKey: ['funding', 'dva'] });
      if (created?.status === 'pending') {
        // The polling effect above keeps refreshing until it turns active.
      }
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not create your account number'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card title="Bank transfer">
      {/* Still loading the user's DVA from the API. */}
      {dvaQuery.isPending && dva === undefined ? (
        <Text style={styles.muted}>Checking your bank account…</Text>
      ) : null}

      {/* Active: show the minted account details vertically, with the account
          number on its own copy-to-clipboard row. */}
      {dva?.status === 'active' && dva.accountNumber ? (
        <>
          <View style={styles.details}>
            {dva.accountName ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Account name</Text>
                <Text style={styles.detailValue}>{dva.accountName}</Text>
              </View>
            ) : null}
            {dva.bankName ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Bank</Text>
                <Text style={styles.detailValue}>{dva.bankName}</Text>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Account number</Text>
              <View style={styles.accountNumberRow}>
                <Text style={[styles.detailValue, styles.accountNumber]}>
                  {groupNumber(dva.accountNumber)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy account number"
                  onPress={copyNumber}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.copyButton,
                    pressed && styles.copyButtonPressed,
                  ]}
                >
                  <Ionicons
                    name={copied ? 'checkmark-circle' : 'copy-outline'}
                    size={20}
                    color={copied ? Colors.success : Colors.primary}
                  />
                </Pressable>
              </View>
              {copied ? <Text style={styles.copied}>Copied to clipboard</Text> : null}
            </View>
          </View>
          <Text style={styles.hint}>
            Transfer any amount to this account number and your wallet is credited automatically.
          </Text>
        </>
      ) : null}

      {/* Pending: bank is provisioning the number asynchronously. */}
      {dva?.status === 'pending' ? (
        <>
          <ActivityIndicator />
          <Text style={styles.muted}>
            We&apos;re preparing your account number — this can take a few minutes.
          </Text>
          <Text style={styles.hint}>
            Anything sent to it will credit your wallet automatically.
          </Text>
        </>
      ) : null}

      {/* Failed: give the user a retry. */}
      {dva?.status === 'failed' ? (
        <>
          <Text style={styles.error}>
            We couldn&apos;t set up your account number. Please try again.
          </Text>
          <Button
            title="Try again"
            variant="outline"
            onPress={create}
            loading={creating}
          />
        </>
      ) : null}

      {/* Never created yet (resolved to null): offer creation. */}
      {dva === null ? (
        <>
          <Text style={styles.muted}>
            Get a personal bank account number you can transfer money to — your
            wallet is credited automatically.
          </Text>
          <Button
            title="Create my account number"
            onPress={create}
            loading={creating}
          />
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  details: {
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  detailRow: { gap: 2 },
  detailLabel: {
    fontSize: Font.xs,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  detailValue: { fontSize: Font.md, fontWeight: '700', color: Colors.text },
  accountNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  accountNumber: {
    fontSize: Font.lg,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: 2,
    flexShrink: 1,
  },
  copyButton: { padding: 2 },
  copyButtonPressed: { opacity: 0.6 },
  copied: {
    fontSize: Font.xs,
    fontWeight: '700',
    color: Colors.success,
    marginTop: Spacing.xs,
  },
  muted: { fontSize: Font.sm, color: Colors.textMuted },
  hint: { fontSize: Font.xs, color: Colors.textMuted, marginTop: Spacing.xs },
  error: { color: Colors.danger, fontSize: Font.sm },
});