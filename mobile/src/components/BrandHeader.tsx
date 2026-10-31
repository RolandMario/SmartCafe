import { StyleSheet, Text, View } from 'react-native';
import { SmartCafeLogo } from './Receipt';
import { Colors, Font, Spacing } from '../constants/theme';

/**
 * Compact brand header that fits at the top of every purchase screen:
 * logo + app name on a single row, centered, with the tagline below.
 */
export default function BrandHeader() {
  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <SmartCafeLogo size={42} variant="brand" />
        <Text style={styles.name}>
          Smart<Text style={styles.gold}>Pay</Text>
        </Text>
      </View>
      <Text style={styles.tagline}>Virtual Top-Up &amp; Bills Payment</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 2, paddingTop: Spacing.xs },
  row: { flexDirection: 'column', alignItems: 'center', gap: Spacing.sm },
  name: { fontSize: Font.lg, fontWeight: '800', color: Colors.text, letterSpacing: 0.5 },
  gold: { color: Colors.gold },
  tagline: { fontSize: Font.xs, color: Colors.textMuted },
});