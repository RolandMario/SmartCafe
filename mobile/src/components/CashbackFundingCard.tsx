import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { walletApi } from '../api/service';
import { apiErrorMessage } from '../api/client';
import { Card } from './ui';
import { Colors, Font, Radius, Spacing } from '../constants/theme';
import type { CashbackAccountInfo } from '../types';

/**
 * Cashback Funding card. Shows the company's Wema bank account users transfer
 * wallet top-ups to. Unlike the dedicated virtual account, these transfers are
 * NOT auto-credited — an admin verifies each one and credits the wallet manually
 * (the user picks "Cashback funding" in the amount card and sends a matching
 * top-up, referencing the funding request).
 */
export function CashbackFundingCard() {
  const [info, setInfo] = useState<CashbackAccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    walletApi
      .cashbackInfo()
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setError('');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(apiErrorMessage(e, 'Could not load cashback funding details'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copyNumber = async () => {
    if (!info) return;
    try {
      await Clipboard.setStringAsync(info.accountNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Some web browsers reject clipboard writes outside a user gesture — ignore.
    }
  };

  return (
    <Card title="Cashback funding">
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading account details…</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {info ? (
        <>
          <Text style={styles.muted}>
            Transfer your top-up amount to our company account below, then create the funding request
            above with the same amount. Keep the transfer reference from your bank — you&apos;ll key it into
            the request so we can verify your transfer.
          </Text>

          {info.cashbackPercentage != null && info.cashbackPercentage > 0 ? (
            <View style={styles.bonus}>
              <Text style={styles.bonusText}>
                You earn {info.cashbackPercentage}% cashback on this top-up — credited to your
                cashback wallet after we verify your transfer.
              </Text>
            </View>
          ) : null}

          <View style={styles.details}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Account name</Text>
              <Text style={styles.detailValue}>{info.accountName}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Account number</Text>
              <View style={styles.accountNumberRow}>
                <Text style={styles.accountNumber}>{info.accountNumber}</Text>
                <Pressable
                  onPress={copyNumber}
                  hitSlop={12}
                  style={({ pressed }) => [
                    styles.copyButton,
                    pressed && styles.copyButtonPressed,
                  ]}
                  accessibilityLabel="Copy account number"
                >
                  <Ionicons
                    name={copied ? 'checkmark-circle' : 'copy-outline'}
                    size={20}
                    color={copied ? Colors.success : Colors.primary}
                  />
                </Pressable>
              </View>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Bank</Text>
              <Text style={styles.detailValue}>{info.bankName}</Text>
            </View>
          </View>

          {copied ? <Text style={styles.copied}>Account number copied</Text> : null}

          <Text style={styles.hint}>
            Top-ups are credited after we confirm your transfer — usually within a few minutes during
            business hours. Keep your funding reference handy.
          </Text>
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  details: {
    backgroundColor: Colors.tealSoft,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginTop: Spacing.md,
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
  bonus: {
    backgroundColor: Colors.successSoft,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    marginTop: Spacing.sm,
  },
  bonusText: {
    fontSize: Font.sm,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  hint: { fontSize: Font.xs, color: Colors.textMuted, marginTop: Spacing.xs },
  error: { color: Colors.danger, fontSize: Font.sm },
});
