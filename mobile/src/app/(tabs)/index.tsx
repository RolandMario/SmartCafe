import { useState } from 'react';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/auth';
import { useBalance, useTransactions } from '../../api/queries';
import { SERVICE_BY_TYPE } from '../../constants/services';
import { SmartCafeLogo } from '../../components/Receipt';
import { FundingReceiptModal } from '../../components/FundingReceipt';
import { Empty, StatusBadge } from '../../components/ui';
import ServiceGrid from '../../components/ServiceGrid';
import { Colors, Font, Radius, Spacing } from '../../constants/theme';
import { formatNaira, timeAgo } from '../../utils/format';
import { FundingRecord, HistoryEntry } from '../../types';

const RECENT_LIMIT = 4;

// WhatsApp community link — see mobile/.env.example. Expo only inlines env
// vars prefixed with EXPO_PUBLIC_ at build time, so prefer the prefixed name,
// fall back to the raw name (for custom bundlers), and finally to the default
// link from .env.example so the header button always has somewhere to go.
const WHATSAPP_GROUP_URL =
  process.env.EXPO_PUBLIC_GROUP_CHAT_URL ??
  process.env.GROUP_CHAT_URL ??
  'https://chat.whatsapp.com/HYZ8oBP3ikz37VPNuPHkHI?s=cl&p=a&mlu=4&ilr=4';

function initials(name?: string): string {
  return (
    name
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || 'U'
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { data: balance } = useBalance();
  const { data: recent, isLoading } = useTransactions({ page: 1, limit: RECENT_LIMIT });
  const [selectedFunding, setSelectedFunding] = useState<FundingRecord | null>(null);

  const refreshBalance = () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  };

  const openWhatsAppGroup = () => {
    const url = WHATSAPP_GROUP_URL?.trim();
    if (url) void Linking.openURL(url).catch(() => {});
  };

  const recentItems: HistoryEntry[] = recent?.items ?? [];

  /** A row in the Recent Transactions feed — purchase or wallet top-up. */
  const renderRecentRow = (t: HistoryEntry) => {
    if ('service' in t) {
      const svc = SERVICE_BY_TYPE[t.service];
      return (
        <Pressable
          key={t._id}
          style={styles.txnRow}
          onPress={() => router.push(`/transaction/${t._id}`)}
        >
          <View
            style={[styles.txnIcon, { backgroundColor: `${svc?.color ?? Colors.primary}1A` }]}
          >
            <Ionicons
              name={(svc?.icon ?? 'receipt-outline') as any}
              size={18}
              color={svc?.color ?? Colors.primary}
            />
          </View>
          <View style={styles.txnInfo}>
            <Text style={styles.txnTitle}>{svc?.label ?? t.service}</Text>
            <Text style={styles.txnMeta}>
              {t.reference} · {timeAgo(t.createdAt)}
            </Text>
          </View>
          <View style={styles.txnRight}>
            <Text style={styles.txnAmount}>{formatNaira(t.amount)}</Text>
            <StatusBadge status={t.status} />
          </View>
        </Pressable>
      );
    }
    return (
      <Pressable
        key={t._id}
        style={styles.txnRow}
        onPress={() => setSelectedFunding(t)}
      >
        <View style={[styles.txnIcon, { backgroundColor: `${Colors.teal}1A` }]}>
          <Ionicons name="wallet-outline" size={18} color={Colors.teal} />
        </View>
        <View style={styles.txnInfo}>
          <Text style={styles.txnTitle}>Wallet top-up</Text>
          <Text style={styles.txnMeta}>
            {t.reference} · {timeAgo(t.createdAt)}
          </Text>
        </View>
        <View style={styles.txnRight}>
          <Text style={[styles.txnAmount, styles.txnAmountCredit]}>
            +{formatNaira(t.amount)}
          </Text>
          <StatusBadge status={t.status} />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Dark-green brand header band */}
      <View style={[styles.band, { paddingTop: insets.top + Spacing.lg }]}>
        <View style={styles.bandRow}>
          <View style={styles.brand}>
            <SmartCafeLogo size={40} variant="light" />
            <View style={styles.brandText}>
              <Text style={styles.brandName}>
                Smart<Text style={styles.brandGold}>Pay</Text>
              </Text>
              <Text style={styles.brandTagline}>Top-Up &amp; Bills Payment</Text>
            </View>
          </View>
          <View style={styles.bandActions}>
            <Pressable
              style={styles.whatsappBtn}
              hitSlop={8}
              onPress={openWhatsAppGroup}
              accessibilityRole="button"
              accessibilityLabel="Join our WhatsApp group"
            >
              <Ionicons name="logo-whatsapp" size={20} color={Colors.white} />
            </Pressable>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(user?.name)}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Light sheet that floats over the green band */}
      <ScrollView
        style={styles.sheet}
        contentContainerStyle={styles.sheetContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Wallet balance card */}
        <View style={styles.walletCard}>
          <View style={styles.walletTop}>
            <View style={styles.walletBalanceBlock}>
              <Text style={styles.walletLabel}>Wallet Balance</Text>
              <Text style={styles.walletBalance}>{formatNaira(balance?.balance ?? 0)}</Text>
              <Text style={styles.walletNgn}>Nigerian Naira · NGN</Text>
            </View>
            <Pressable
              style={styles.refreshBtn}
              hitSlop={8}
              onPress={refreshBalance}
              accessibilityRole="button"
              accessibilityLabel="Refresh balance"
            >
              <Ionicons name="refresh" size={18} color={Colors.primaryDark} />
            </Pressable>
          </View>
          <View style={styles.walletBottom}>
            <View style={styles.cashbackChip}>
              <Ionicons name="gift-outline" size={15} color={Colors.success} />
              <Text style={styles.cashbackText}>
                Cashback {formatNaira(balance?.cashbackBalance ?? 0)}
              </Text>
            </View>
            <Pressable
              style={styles.addMoneyBtn}
              onPress={() => router.push('/fund')}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={16} color={Colors.white} />
              <Text style={styles.addMoneyText}>Add Money</Text>
            </Pressable>
          </View>
        </View>

        {/* Quick actions — all 6 services as a 3-column card grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <ServiceGrid />
        </View>

        {/* Recent transactions */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Recent Transactions</Text>
            <Pressable hitSlop={8} onPress={() => router.push('/transactions')}>
              <Text style={styles.viewAll}>View All</Text>
            </Pressable>
          </View>
          {isLoading ? (
            <Empty title="Loading…" />
          ) : recentItems.length === 0 ? (
            <Empty title="No transactions yet" subtitle="Your purchases will appear here." />
          ) : (
            <View style={styles.txnList}>
              {recentItems.map(renderRecentRow)}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Receipt for a tapped wallet top-up. */}
      <FundingReceiptModal
        visible={!!selectedFunding}
        data={{
          name: user?.name ?? '',
          phone: user?.phone ?? '',
          amount: selectedFunding?.amount ?? 0,
          reference: selectedFunding?.reference ?? '',
          transferReference: selectedFunding?.transferReference,
          createdAt: selectedFunding?.createdAt,
          status: selectedFunding?.status ?? 'pending',
        }}
        onClose={() => setSelectedFunding(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.header },
  band: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl + Spacing.lg },
  bandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  brandText: { gap: 2 },
  brandName: { color: Colors.white, fontSize: Font.lg, fontWeight: '800', letterSpacing: 0.3 },
  brandGold: { color: Colors.gold },
  brandTagline: { color: 'rgba(255,255,255,0.75)', fontSize: Font.xs },
  bandActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  whatsappBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#25D366', // WhatsApp green
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.primaryDark, fontWeight: '800', fontSize: Font.sm },
  sheet: {
    flex: 1,
    marginTop: -Radius.lg,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.xl },
  walletCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 2,
  },
  walletTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  walletBalanceBlock: { gap: 2 },
  walletLabel: {
    color: Colors.textMuted,
    fontSize: Font.sm,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  walletBalance: { color: Colors.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  walletNgn: { color: Colors.textMuted, fontSize: Font.xs },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cashbackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.successSoft,
  },
  cashbackText: { color: Colors.success, fontSize: Font.xs, fontWeight: '700' },
  addMoneyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryDark,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  addMoneyText: { color: Colors.white, fontSize: Font.sm, fontWeight: '700' },
  section: { gap: Spacing.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: Font.lg, fontWeight: '800', color: Colors.text },
  viewAll: { color: Colors.primary, fontSize: Font.sm, fontWeight: '700' },
  txnList: { gap: Spacing.sm },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  txnIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  txnInfo: { flex: 1, gap: 2 },
  txnTitle: { fontSize: Font.md, fontWeight: '700', color: Colors.text },
  txnMeta: { fontSize: Font.xs, color: Colors.textMuted },
  txnRight: { alignItems: 'flex-end', gap: Spacing.xs },
  txnAmount: { fontSize: Font.md, fontWeight: '800', color: Colors.text },
  txnAmountCredit: { color: Colors.success },
});
