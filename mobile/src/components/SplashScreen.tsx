import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as NativeSplashScreen from 'expo-splash-screen';
import { Colors, Font, Spacing } from '../constants/theme';
import logo from '../../assets/images/smartcafe.png';

/**
 * Background matches the native launch splash configured in app.json
 * (`"backgroundColor": "#0C4A2B"`) so the OS-level splash hands off to this
 * animated one with no visible seam.
 */
const SPLASH_BG = Colors.header;

const LOGO_SIZE = 128;

const ENTRANCE_MS = 850; // logo fades/scales in
const TEXT_MS = 700; // app name + tagline rise in
const HOLD_MS = 850; // brief pause at full branding
const EXIT_MS = 450; // cross-fade out, revealing the login screen

/**
 * Animated in-app splash shown on top of the navigator while auth state is
 * being hydrated. Renders the SmartCafe logo, plays a short entrance, then
 * fades out and reports completion via `onFinish`.
 */
export default function SplashScreen({ onFinish }: { onFinish?: () => void }) {
  // Animated values are created once per mount. `useState` (rather than
  // `useRef`) keeps react-hooks/refs happy — reading these stable instances
  // during render is safe.
  const [overlay] = useState(() => new Animated.Value(1));
  const [logoOpacity] = useState(() => new Animated.Value(0));
  const [logoScale] = useState(() => new Animated.Value(0.75));
  const [glowOpacity] = useState(() => new Animated.Value(0));
  const [glowScale] = useState(() => new Animated.Value(0.6));
  const [textOpacity] = useState(() => new Animated.Value(0));
  const [textRaise] = useState(() => new Animated.Value(16));

  // Keep the latest onFinish without re-triggering the one-shot animation.
  const onFinishRef = useRef(onFinish);

  useEffect(() => {
    onFinishRef.current = onFinish;
  });

  useEffect(() => {
    // Hand the native splash to this in-app splash now that our first frame is
    // painted. Both backgrounds are the same color so the swap is invisible.
    void NativeSplashScreen.hideAsync();

    const entrance = Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: ENTRANCE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(logoScale, {
        toValue: 1,
        duration: ENTRANCE_MS,
        easing: Easing.out(Easing.back(1.3)),
        useNativeDriver: true,
      }),
      Animated.timing(glowOpacity, {
        toValue: 1,
        duration: ENTRANCE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(glowScale, {
        toValue: 1,
        duration: ENTRANCE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    const text = Animated.parallel([
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: TEXT_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(textRaise, {
        toValue: 0,
        duration: TEXT_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    const exit = Animated.parallel([
      Animated.timing(overlay, {
        toValue: 0,
        duration: EXIT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(logoScale, {
        toValue: 0.85,
        duration: EXIT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    const animation = Animated.sequence([entrance, text, Animated.delay(HOLD_MS), exit]);
    animation.start(({ finished }) => {
      if (finished) onFinishRef.current?.();
    });

    return () => animation.stop();
  }, [glowOpacity, glowScale, logoOpacity, logoScale, overlay, textOpacity, textRaise]);

  return (
    <Animated.View
      style={[styles.overlay, { opacity: overlay }]}
      accessibilityViewIsModal
      accessibilityLabel="SmartCafe"
    >
      <StatusBar style="light" />
      <View style={styles.content}>
        <View style={styles.brand}>
          <Animated.View
            style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]}
          />
          <Animated.Image
            source={logo}
            style={[styles.logo, { opacity: logoOpacity, transform: [{ scale: logoScale }] }]}
            resizeMode="contain"
          />
        </View>
        <Animated.View
          style={[styles.textBlock, { opacity: textOpacity, transform: [{ translateY: textRaise }] }]}
        >
          <Text style={styles.appName}>
            Smart<Text style={styles.appGold}>Pay</Text>
          </Text>
          <Text style={styles.tagline}>Virtual Top-Up &amp; Bills Payment</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { alignItems: 'center', gap: Spacing.xl },
  brand: {
    width: LOGO_SIZE * 2,
    height: LOGO_SIZE * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: LOGO_SIZE * 1.9,
    height: LOGO_SIZE * 1.9,
    borderRadius: LOGO_SIZE * 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
  textBlock: { alignItems: 'center', gap: Spacing.xs },
  appName: { fontSize: Font.xxl, fontWeight: '800', color: Colors.white, letterSpacing: 0.5 },
  appGold: { color: Colors.gold },
  tagline: { fontSize: Font.sm, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.3 },
});