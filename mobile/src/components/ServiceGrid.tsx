import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { LayoutChangeEvent } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SERVICES } from '../constants/services';
import { Colors, Font, Radius, Spacing } from '../constants/theme';

/** Gap between cards — keep in sync with `gap` in `styles.grid`. */
const CARD_GAP = Spacing.md;

/**
 * 3-column card grid of every service. Tapping a card opens that service's
 * purchase screen. Shared by the Home quick-actions block and the Services tab.
 *
 * The grid measures its own rendered width and sizes each card to exactly
 * `(gridWidth - 2 * CARD_GAP) / 3` so it always shows 3 columns on any screen
 * width. (A fixed percentage basis combined with `gap` wraps to 2 columns on
 * narrower Android screens because the two gutters eat into the percentage.)
 */
export default function ServiceGrid() {
  const router = useRouter();
  const [gridWidth, setGridWidth] = useState(0);

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    if (width > 0 && Math.abs(width - gridWidth) > 0.5) {
      setGridWidth(width);
    }
  };

  // Exact width of a single card: 3 cards per row, 2 inter-card gutters.
  const cardWidth = gridWidth > 0 ? (gridWidth - 2 * CARD_GAP) / 3 : '31%';

  return (
    <View style={styles.grid} onLayout={handleLayout}>
      {SERVICES.map((s) => (
        <Pressable
          key={s.key}
          style={({ pressed }) => [
            styles.card,
            gridWidth > 0 && { width: cardWidth },
            pressed && styles.cardPressed,
          ]}
          onPress={() => router.push(s.route)}
        >
          <View style={[styles.icon, { backgroundColor: `${s.color}1A` }]}>
            <Ionicons name={s.icon as any} size={22} color={s.color} />
          </View>
          <Text style={styles.label}>{s.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: CARD_GAP },
  card: {
    // Fallback width until onLayout reports the real grid width (first frame).
    width: '31%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xs,
    gap: Spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 1,
  },
  cardPressed: { opacity: 0.8 },
  icon: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: Font.sm, fontWeight: '700', color: Colors.text, textAlign: 'center' },
});