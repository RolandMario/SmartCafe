import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import BrandBand, { brandRoot, brandSheet } from '../../components/BrandBand';
import { Ionicons } from '@expo/vector-icons';
import { useAnalytics } from '../../api/queries';
import AnalyticsChart from '../../components/AnalyticsChart';
import { Card, Empty } from '../../components/ui';
import { SERVICE_BY_TYPE } from '../../constants/services';
import { Colors, Font, Radius, Spacing } from '../../constants/theme';
import { formatNaira } from '../../utils/format';

/** How many months back the selector reaches. */
const MONTH_OPTIONS = 12;

/** '2026-09' -> 'Sep 26' */
function monthShortLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
    month: 'short',
    year: '2-digit',
  });
}

/** '2026-09' -> 'September 2026' */
function monthFullLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });
}

/** The last `n` calendar months as `YYYY-MM` keys, oldest -> newest. */
function recentMonths(n: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    );
  }
  return keys;
}

export default function AnalyticsScreen() {
  const months = useMemo(() => recentMonths(MONTH_OPTIONS), []);
  // Default to the current (most recent) month.
  const [month, setMonth] = useState(months[months.length - 1]);

  const { data, isLoading } = useAnalytics(month);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const spent = items.reduce((sum, i) => sum + i.volume, 0);

  return (
    <View style={brandRoot}>
      <BrandBand
        title="Analytics"
        subtitle="How many of each service you bought, per month."
      />

      {/* Light sheet that overlaps the green band — same as the home screen */}
      <View style={brandSheet}>
        <View style={styles.monthBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.monthRow}
          >
            {months.map((key) => {
              const selected = key === month;
              return (
                <Pressable
                  key={key}
                  onPress={() => setMonth(key)}
                  accessibilityRole="button"
                  style={[
                    styles.monthChip,
                    selected && styles.monthChipSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.monthText,
                      selected && styles.monthTextSelected,
                    ]}
                  >
                    {monthShortLabel(key)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Bar chart card */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{monthFullLabel(month)}</Text>
              <View style={styles.totalPill}>
                <Text style={styles.totalPillText}>
                  {total} purchase{total === 1 ? '' : 's'}
                </Text>
              </View>
            </View>

            {isLoading ? (
              <Empty title="Loading…" />
            ) : total === 0 ? (
              <Empty
                title={`No purchases in ${monthFullLabel(month)}`}
                subtitle="Buy airtime, data or pay bills and your analytics will show up here."
              />
            ) : (
              <>
                <AnalyticsChart items={items} />
                <Text style={styles.spent}>
                  Total spent · {formatNaira(spent)}
                </Text>
              </>
            )}
          </Card>

          {/* Per-service breakdown */}
          {!isLoading && total > 0 ? (
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>By service</Text>
              <View style={styles.breakdown}>
                {items.map((item) => {
                  const config = SERVICE_BY_TYPE[item.service];
                  const color = config?.color ?? Colors.primary;
                  const icon = (config?.icon ?? 'receipt-outline') as any;
                  return (
                    <View key={item.service} style={styles.breakRow}>
                      <View style={styles.breakLeft}>
                        <View
                          style={[
                            styles.breakIcon,
                            { backgroundColor: `${color}1A` },
                          ]}
                        >
                          <Ionicons name={icon} size={16} color={color} />
                        </View>
                        <Text style={styles.breakLabel}>
                          {config?.label ?? item.service}
                        </Text>
                      </View>
                      <View style={styles.breakRight}>
                        <Text style={styles.breakCount}>
                          {item.count} purchase{item.count === 1 ? '' : 's'}
                        </Text>
                        <Text style={styles.breakAmount}>
                          {formatNaira(item.volume)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </Card>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  monthBar: {
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  monthRow: { gap: Spacing.sm },
  monthChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  monthChipSelected: {
    backgroundColor: Colors.primarySoft,
    borderColor: Colors.primary,
  },
  monthText: { color: Colors.textMuted, fontWeight: '600', fontSize: Font.sm },
  monthTextSelected: { color: Colors.primaryDark, fontWeight: '800' },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.lg,
  },
  card: { gap: Spacing.md },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: { fontSize: Font.lg, fontWeight: '800', color: Colors.text },
  totalPill: {
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  totalPillText: {
    color: Colors.primaryDark,
    fontWeight: '800',
    fontSize: Font.sm,
  },
  spent: {
    fontSize: Font.sm,
    color: Colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },
  breakdown: { gap: Spacing.sm },
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  breakLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  breakIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakLabel: { fontSize: Font.md, fontWeight: '700', color: Colors.text },
  breakRight: { alignItems: 'flex-end', gap: 2 },
  breakCount: { fontSize: Font.sm, fontWeight: '700', color: Colors.text },
  breakAmount: { fontSize: Font.xs, color: Colors.textMuted },
});
