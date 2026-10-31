import { useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import BrandBand, { brandRoot, brandSheet } from '../../components/BrandBand';
import { Ionicons } from '@expo/vector-icons';
import { useTransactions } from '../../api/queries';
import { StatusBadge, Empty, OptionChips, Button } from '../../components/ui';
import { FundingReceiptModal } from '../../components/FundingReceipt';
import { SERVICES, SERVICE_BY_TYPE } from '../../constants/services';
import { Colors, Font, Spacing } from '../../constants/theme';
import { formatNaira, timeAgo } from '../../utils/format';
import { useAuthStore } from '../../store/auth';
import { FundingRecord, ServiceType, Transaction } from '../../types';

const PAGE_SIZE = 15;
/** Filter bucket shown alongside the individual service types. */
const FILTER_ALL = 'ALL';
/** Wallet top-ups have no service type — they get their own filter bucket. */
const FILTER_FUNDING = 'FUNDING';

type FilterValue = ServiceType | typeof FILTER_ALL | typeof FILTER_FUNDING;

export default function TransactionsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [service, setService] = useState<FilterValue>(FILTER_ALL);
  const [page, setPage] = useState(1);
  /** Funding record whose receipt modal is currently open (History tap). */
  const [selectedFunding, setSelectedFunding] = useState<FundingRecord | null>(null);

  const { data, isLoading } = useTransactions({
    page,
    limit: PAGE_SIZE,
    // Funding rows have no service; asking the backend to filter by one hides
    // them, so "All" and "Funding" query the full feed and the "Funding" chip
    // filters it client-side.
    service:
      service === FILTER_ALL || service === FILTER_FUNDING ? undefined : service,
  });

  const items: (Transaction | FundingRecord)[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Under the "Funding" bucket only wallet top-ups are drawn; everywhere else
  // (All + individual services) the feed is used as returned.
  const visibleItems =
    service === FILTER_FUNDING
      ? items.filter((item) => !('service' in item))
      : items;

  const filterOptions: FilterValue[] = [
    FILTER_ALL,
    FILTER_FUNDING,
    ...SERVICES.map((s) => s.service),
  ];

  const changeService = (next: string | number) => {
    setService(next as FilterValue);
    setPage(1); // a different filter restarts from the first page
  };

  const goToPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages));
  };

  return (
    <View style={brandRoot}>
      <BrandBand title="History" />

      {/* Light sheet that overlaps the green band — same as the home screen */}
      <View style={brandSheet}>
        <View style={styles.filterWrap}>
          <OptionChips
            options={filterOptions}
            value={service}
            onChange={changeService}
            renderLabel={(v) =>
              v === FILTER_ALL
                ? 'All'
                : v === FILTER_FUNDING
                  ? 'Funding'
                  : (SERVICE_BY_TYPE[v]?.label ?? String(v))
            }
          />
        </View>

        <FlatList
          data={visibleItems}
          keyExtractor={(t) => t._id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            isLoading ? (
              <Empty title="Loading…" />
            ) : service === FILTER_FUNDING ? (
              <Empty
                title="No top-ups yet"
                subtitle="Wallet funding requests will appear here."
              />
            ) : (
              <Empty
                title="No transactions yet"
                subtitle="Your purchases and wallet top-ups will appear here."
              />
            )
          }
          renderItem={({ item }) =>
            'service' in item ? (
              <PurchaseRow
                item={item}
                onPress={() => router.push(`/transaction/${item._id}`)}
              />
            ) : (
              <FundingRow item={item} onPress={() => setSelectedFunding(item)} />
            )
          }
        />

        {/* Pagination — 15 transactions per page */}
        <View style={styles.pager}>
          <Button
            title="Previous"
            variant="outline"
            block={false}
            disabled={page <= 1}
            onPress={() => goToPage(page - 1)}
          />
          <Text style={styles.pageInfo}>
            Page {page} of {totalPages}
          </Text>
          <Button
            title="Next"
            variant="outline"
            block={false}
            disabled={page >= totalPages}
            onPress={() => goToPage(page + 1)}
          />
        </View>
      </View>

      {/* Receipt for a tapped wallet top-up, popped over the list. */}
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

/** A purchase (airtime, data, cable, …) row. */
function PurchaseRow({
  item,
  onPress,
}: {
  item: Transaction;
  onPress: () => void;
}) {
  const svc = SERVICE_BY_TYPE[item.service];
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: `${svc?.color ?? Colors.primary}1A` },
        ]}
      >
        <Ionicons
          name={(svc?.icon ?? 'receipt-outline') as any}
          size={18}
          color={svc?.color ?? Colors.primary}
        />
      </View>
      <View style={styles.rowLeft}>
        <Text style={styles.rowTitle}>{svc?.label ?? item.service}</Text>
        <Text style={styles.rowMeta}>
          {item.reference} · {timeAgo(item.createdAt)}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowAmount}>{formatNaira(item.amount)}</Text>
        <StatusBadge status={item.status} />
      </View>
    </Pressable>
  );
}

/** A wallet funding (top-up) row — opens its receipt on tap. */
function FundingRow({
  item,
  onPress,
}: {
  item: FundingRecord;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.rowIcon, { backgroundColor: `${Colors.teal}1A` }]}>
        <Ionicons name="wallet-outline" size={18} color={Colors.teal} />
      </View>
      <View style={styles.rowLeft}>
        <Text style={styles.rowTitle}>Wallet top-up</Text>
        <Text style={styles.rowMeta}>
          {item.reference} · {timeAgo(item.createdAt)}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, styles.rowAmountCredit]}>
          +{formatNaira(item.amount)}
        </Text>
        <StatusBadge status={item.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterWrap: {
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLeft: { gap: Spacing.xs, flex: 1, paddingRight: Spacing.sm },
  rowTitle: { fontSize: Font.md, fontWeight: '700', color: Colors.text },
  rowMeta: { fontSize: Font.xs, color: Colors.textMuted },
  rowRight: { alignItems: 'flex-end', gap: Spacing.xs },
  rowAmount: { fontSize: Font.md, fontWeight: '800', color: Colors.text },
  rowAmountCredit: { color: Colors.success },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    gap: Spacing.md,
  },
  pageInfo: {
    fontSize: Font.sm,
    color: Colors.textMuted,
    flex: 1,
    textAlign: 'center',
  },
});
