import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { usePinStatus } from '../api/queries';
import { usersApi } from '../api/service';
import { apiErrorMessage } from '../api/client';
import { Screen, Button, Field, Card } from '../components/ui';
import { Colors, Font, Spacing } from '../constants/theme';

// The fields deliberately do NOT filter in onChangeText — rewriting a
// TextInput's value to the same string it already holds makes backspace a no-op
// on some Android IMEs (react-native#19085/#19495). Values are instead sanitized
// once, here, right before they are validated or sent.
const toDigits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

export default function PinScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: pinStatus, isLoading } = usePinStatus();
  const hasPin = pinStatus?.hasPin ?? false;

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // This screen is presented as a modal, and iOS often fails to raise the
  // keyboard from autoFocus alone. Focus the first PIN field once the modal
  // animation has settled so users can start typing immediately.
  const currentPinRef = useRef<TextInput>(null);
  const newPinRef = useRef<TextInput>(null);
  useEffect(() => {
    if (isLoading) return;
    const t = setTimeout(() => {
      if (hasPin) currentPinRef.current?.focus();
      else newPinRef.current?.focus();
    }, 400);
    return () => clearTimeout(t);
  }, [isLoading, hasPin]);

  if (isLoading) {
    return (
      <Screen scroll={false}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </Screen>
    );
  }

  const submit = async () => {
    setError('');
    const current = toDigits(currentPin);
    const next = toDigits(newPin);
    const confirm = toDigits(confirmPin);
    if (next.length !== 4) {
      setError('New PIN must be exactly 4 digits');
      return;
    }
    if (next !== confirm) {
      setError('New PINs do not match');
      return;
    }
    if (hasPin && current.length !== 4) {
      setError('Enter your current 4-digit PIN');
      return;
    }
    setSaving(true);
    try {
      await usersApi.setPin({ pin: next, ...(hasPin ? { currentPin: current } : {}) });
      await queryClient.invalidateQueries({ queryKey: ['pin', 'status'] });
      setSaved(true);
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not save transaction PIN'));
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <Screen>
        <Card style={styles.doneCard}>
          <Text style={styles.doneTitle}>✓ Transaction PIN saved</Text>
          <Text style={styles.muted}>
            Your 4-digit transaction PIN will now be required to authorise every purchase.
          </Text>
        </Card>
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>{hasPin ? 'Change transaction PIN' : 'Set transaction PIN'}</Text>
      <Text style={styles.muted}>
        Your 4-digit PIN is used to authorise every transaction you send from SmartCafe. Keep it
        private.
      </Text>

      {hasPin ? (
        <Field
          label="Current PIN"
          ref={currentPinRef}
          value={currentPin}
          onChangeText={setCurrentPin}
          placeholder="••••"
          secureTextEntry
          inputMode={Platform.OS === 'ios' ? 'numeric' : undefined}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
        />
      ) : null}

      <View style={styles.fields}>
        <Field
          label="New PIN"
          ref={newPinRef}
          value={newPin}
          onChangeText={setNewPin}
          placeholder="••••"
          secureTextEntry
          inputMode={Platform.OS === 'ios' ? 'numeric' : undefined}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
        />
        <Field
          label="Confirm new PIN"
          value={confirmPin}
          onChangeText={setConfirmPin}
          placeholder="••••"
          secureTextEntry
          inputMode={Platform.OS === 'ios' ? 'numeric' : undefined}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button title={hasPin ? 'Update PIN' : 'Save PIN'} onPress={submit} loading={saving} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: Font.xl, fontWeight: '800', color: Colors.text },
  muted: { fontSize: Font.sm, color: Colors.textMuted },
  fields: { gap: 0 },
  error: { color: Colors.danger, fontSize: Font.sm },
  doneCard: { gap: Spacing.sm },
  doneTitle: { fontSize: Font.lg, fontWeight: '800', color: Colors.success },
});