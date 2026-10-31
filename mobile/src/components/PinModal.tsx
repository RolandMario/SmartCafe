import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from './ui';
import { SmartCafeLogo } from './Receipt';
import { Colors, Font, Radius, Spacing } from '../constants/theme';
import { formatNaira } from '../utils/format';

/**
 * Transaction PIN prompt.
 *
 * Deliberately NOT a native <Modal>: the confirm screen is itself presented as
 * a modal (sheet), and iOS routinely refuses to raise the keyboard for a
 * TextInput inside that nested-modal stack (or drops the keyboard the moment it
 * appears). Rendering a plain full-screen overlay keeps the field in the main
 * view hierarchy, so the keyboard comes up reliably — the same approach that
 * already works on the PIN setup screen.
 *
 * UI: four visual digit boxes (bank-app style). The user actually types into a
 * single, invisible TextInput stretched across the boxes — not four separate
 * inputs — which keeps the proven single-field semantics below (one caret, no
 * value rewrites, platform-split keyboard, one ref used by the focus effects).
 */
export function PinModal({
  visible,
  title,
  amount,
  error,
  loading,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title?: string;
  amount?: number;
  error?: string | null;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (pin: string) => void;
}) {
  const [pin, setPin] = useState('');
  const inputRef = useRef<TextInput>(null);

  const handleClose = useCallback(() => {
    setPin('');
    onClose();
  }, [onClose]);

  // Raise the keypad every time the overlay opens — iOS only. autoFocus covers
  // the normal case; the staggered focus calls catch the cases where iOS drops
  // the first focus while the overlay/layout is still settling. Android needs
  // none of this, and repeatedly calling focus() while its IME is settling can
  // actually dismiss the software keyboard (see react-native#20361). The overlay
  // (and its pin state) is mounted only while `visible`, so nothing needs
  // resetting here.
  useEffect(() => {
    if (!visible || Platform.OS !== 'ios') return;
    const focus = () => inputRef.current?.focus();
    const timers = [80, 250, 500].map((ms) => setTimeout(focus, ms));
    return () => timers.forEach(clearTimeout);
  }, [visible]);

  // After a failed attempt the keyboard can drop together with the error UI;
  // bring focus back so the user can retype immediately.
  useEffect(() => {
    if (!visible || !error || loading) return;
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [visible, error, loading]);

  // Android hardware back behaves like the Cancel button while the overlay is up.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, handleClose]);

  if (!visible) return null;

  // `pin` keeps exactly what the user typed — the inputs never rewrite the field
  // value, because rewriting it to the same string is what makes backspace a
  // no-op on some Android IMEs (react-native#19085/#19495). Every consumer below
  // therefore works on the sanitized digits only.
  const digits = pin.replace(/\D/g, '').slice(0, 4);

  const submit = () => {
    if (!/^\d{4}$/.test(digits)) return;
    onConfirm(digits);
  };

  // The TextInput below keeps `pin` exactly as typed — sanitization happens in
  // `digits` above, and nothing ever rewrites the field with identical text
  // (that's what made backspace a no-op on some Android IMEs). Also no
  // keyboardType / inputMode on Android: the numeric keypad has no delete key
  // on several Android IMEs, and inputMode='numeric' maps straight back to that
  // same keyboard (see TextInput's inputModeToKeyboardTypeMap). Android gets the
  // default QWERTY, which always exposes backspace; iOS gets the numeric pad.
  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.centered}
      >
        <View style={styles.card}>
          <SmartCafeLogo size={52} variant="brand" />
          <Text style={styles.title}>Enter transaction PIN</Text>
          {title ? <Text style={styles.subtitle}>{title}</Text> : null}
          {amount != null ? (
            <Text style={styles.amount}>{formatNaira(amount)}</Text>
          ) : null}

          <Pressable
            accessibilityLabel="Enter your 4-digit transaction PIN"
            accessibilityHint={`${digits.length} of 4 digits entered`}
            onPress={() => inputRef.current?.focus()}
            style={styles.pinBoxes}
          >
            <TextInput
              ref={inputRef}
              autoFocus
              value={pin}
              onChangeText={setPin}
              style={styles.hiddenInput}
              secureTextEntry
              caretHidden
              contextMenuHidden
              autoCorrect={false}
              autoCapitalize="none"
              autoComplete="off"
              inputMode={Platform.OS === 'ios' ? 'numeric' : undefined}
              textAlign="center"
            />
            {[0, 1, 2, 3].map((i) => {
              const filled = digits.length > i;
              // Highlight the slot the next digit will land in, mirroring the
              // auto-advance feel of the four-input design without any focus games.
              const active = !filled && digits.length === i;
              return (
                <View
                  key={i}
                  style={[
                    styles.pinBox,
                    filled && styles.pinBoxFilled,
                    active && styles.pinBoxActive,
                  ]}
                >
                  {filled ? <View style={styles.pinDot} /> : null}
                </View>
              );
            })}
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            title="Confirm payment"
            onPress={submit}
            loading={loading}
            disabled={digits.length !== 4}
          />
          <Button title="Cancel" variant="ghost" onPress={handleClose} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
  },
  centered: {
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  title: { fontSize: Font.lg, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: Font.sm, color: Colors.textMuted, textAlign: 'center' },
  amount: { fontSize: Font.xl, fontWeight: '800', color: Colors.primary },
  pinBoxes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  // Invisible single TextInput stretched over the boxes: keeps one caret and
  // the platform-split keyboard while presenting the four-box look.
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    color: 'transparent',
    fontSize: Font.xxl,
    fontWeight: '800',
    padding: 0,
  },
  pinBox: {
    width: 56,
    height: 60,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBoxFilled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  pinBoxActive: {
    borderColor: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
  },
  pinDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  error: { color: Colors.danger, fontSize: Font.sm, textAlign: 'center' },
});