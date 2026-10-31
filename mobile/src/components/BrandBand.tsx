import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import { SmartCafeLogo } from './Receipt';
import { Colors, Font, Radius, Spacing } from '../constants/theme';

/**
 * Thick dark-green brand band at the top of a screen — the same visual used on
 * the home screen header. It runs edge-to-edge behind the status bar, shows the
 * SmartCafe logo with a white title, and a light `brandSheet` placed below it
 * will overlap the band with rounded top corners.
 */
export default function BrandBand({
  title,
  subtitle,
  onBack,
  right,
  center = false,
}: {
  title: string;
  subtitle?: string;
  /** Show a white circular back button on the left (e.g. pushed purchase screens). */
  onBack?: () => void;
  /** Optional element rendered on the right side of the band. */
  right?: ReactNode;
  /** Center the logo + title (used by purchase screens). */
  center?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <>
      <StatusBar style="light" />
      <View style={[styles.band, { paddingTop: insets.top + Spacing.lg }]}>
        <View style={[styles.row, center && styles.rowCenter]}>
          {onBack ? (
            <Pressable
              style={styles.backBtn}
              hitSlop={8}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons
                name="chevron-back"
                size={22}
                color={Colors.primaryDark}
              />
            </Pressable>
          ) : null}
          <View style={styles.brand}>
            <SmartCafeLogo size={40} variant="light" />
            <View style={styles.brandText}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? (
                <Text style={styles.subtitle}>{subtitle}</Text>
              ) : null}
            </View>
          </View>
          {right ? (
            <View style={center ? styles.right : undefined}>{right}</View>
          ) : null}
        </View>
      </View>
    </>
  );
}

/** Root container for banded screens — the dark green shows behind the light sheet. */
export const brandRoot = { flex: 1, backgroundColor: Colors.header } as const;

/** Light sheet that overlaps the green band with rounded top corners (like the home screen). */
export const brandSheet = {
  flex: 1,
  marginTop: -Radius.lg,
  backgroundColor: Colors.background,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  overflow: 'hidden',
} as const;

const styles = StyleSheet.create({
  band: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl + Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowCenter: { justifyContent: 'center', position: 'relative' },
  backBtn: {
    position: 'absolute',
    left: 0,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  brandText: { gap: 2 },
  title: {
    color: Colors.white,
    fontSize: Font.lg,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: Font.xs },
  right: { position: 'absolute', right: 0, top: 0 },
});
