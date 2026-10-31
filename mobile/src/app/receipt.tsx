import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePurchaseStore } from '../store/purchase';
import { Screen, Button } from '../components/ui';
import Receipt, { ReceiptHandle } from '../components/Receipt';
import { Colors, Font, Spacing } from '../constants/theme';

export default function ReceiptScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const result = usePurchaseStore((s) => s.result);
  const receiptRef = useRef<ReceiptHandle>(null);

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
  }, [queryClient]);

  if (!result) {
    return (
      <Screen>
        <Text style={styles.muted}>No receipt available.</Text>
        <Button title="Go home" onPress={() => router.replace('/(tabs)')} />
      </Screen>
    );
  }

  const txn = result.transaction;

  return (
    <Screen scroll={false}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Receipt ref={receiptRef} transaction={txn} showShareButton={false} />
      </ScrollView>

      {/* Pinned bottom actions: Share receipt + Done sit side-by-side and are
          padded above the iOS home indicator / Android nav bar. */}
      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
        <Button
          title="View transactions"
          variant="ghost"
          onPress={() => router.replace('/(tabs)/transactions')}
        />
        <View style={styles.buttonRow}>
          <View style={styles.buttonFlex}>
            <Button
              title="Share receipt"
              variant="outline"
              onPress={() => receiptRef.current?.share()}
            />
          </View>
          <View style={styles.buttonFlex}>
            <Button title="Done" onPress={() => router.replace('/(tabs)')} />
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: Spacing.xl },
  actions: { gap: Spacing.sm },
  buttonRow: { flexDirection: 'row', gap: Spacing.md },
  buttonFlex: { flex: 1 },
  muted: { fontSize: Font.sm, color: Colors.textMuted, marginBottom: Spacing.md },
});
