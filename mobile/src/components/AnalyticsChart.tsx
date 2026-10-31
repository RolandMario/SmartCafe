import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SERVICE_BY_TYPE } from '../constants/services';
import { Colors, Font, Spacing } from '../constants/theme';
import { ServiceStatsItem } from '../types';

/** Height of the plot area — the tallest bar fills most of it, leaving room for the count label. */
const PLOT_HEIGHT = 150;
/** Height the tallest bar can reach inside the plot area (padding for the value on top). */
const MAX_BAR = PLOT_HEIGHT - 24;
/** Smallest visible bar for a service with at least one purchase. */
const MIN_BAR = 4;
const BAR_WIDTH = 20;

/** Compact labels that fit under each bar on a phone-width chart. */
const SHORT_LABELS: Record<string, string> = {
  AIRTIME: 'Airtime',
  DATA: 'Data',
  CABLE: 'Cable TV',
  ELECTRICITY: 'Electricity',
  WAEC: 'WAEC',
  JAMB: 'JAMB',
  SMS: 'Bulk SMS',
};

/**
 * Zero-dependency vertical bar chart. One bar per service type; bar height is
 * proportional to that service's successful purchase count for the selected
 * month. Drawn with plain Views so it renders identically on iOS, Android and
 * web without pulling in an SVG/native chart library.
 */
export default function AnalyticsChart({ items }: { items: ServiceStatsItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.count));

  return (
    <View style={styles.row}>
      {items.map((item) => {
        const config = SERVICE_BY_TYPE[item.service];
        const color = config?.color ?? Colors.primary;
        const icon = (config?.icon ?? 'receipt-outline') as any;
        const label = SHORT_LABELS[item.service] ?? config?.label ?? item.service;
        const barHeight =
          item.count > 0 ? Math.max(MIN_BAR, Math.round((item.count / max) * MAX_BAR)) : 2;

        return (
          <View key={item.service} style={styles.col}>
            <View style={styles.plot}>
              <View style={styles.barBlock}>
                <Text style={styles.barValue} numberOfLines={1} adjustsFontSizeToFit>
                  {item.count}
                </Text>
                <View
                  style={[
                    styles.bar,
                    {
                      height: barHeight,
                      backgroundColor: item.count > 0 ? color : Colors.border,
                    },
                  ]}
                />
              </View>
            </View>
            <View style={[styles.iconWrap, { backgroundColor: `${color}1A` }]}>
              <Ionicons name={icon} size={14} color={color} />
            </View>
            <Text style={styles.label} numberOfLines={2}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'center' },
  plot: {
    height: PLOT_HEIGHT,
    justifyContent: 'flex-end',
    marginBottom: Spacing.sm,
  },
  barBlock: { alignItems: 'center' },
  barValue: {
    fontSize: Font.sm,
    fontWeight: '800',
    color: Colors.text,
    minWidth: BAR_WIDTH + 8,
    textAlign: 'center',
  },
  bar: {
    width: BAR_WIDTH,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    marginTop: 2,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  label: {
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center',
    fontWeight: '600',
    paddingHorizontal: 2,
  },
});