import { useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/auth';
import { authApi } from '../../api/service';
import { apiErrorMessage } from '../../api/client';
import { isValidNigerianPhone } from '../../utils/format';
import { Screen, Button, Field } from '../../components/ui';
import { Colors, Font, Spacing } from '../../constants/theme';

export default function RegisterScreen() {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!name || !email || !password) {
      setError('Please fill in all fields');
      return;
    }
    if (!isValidNigerianPhone(phone)) {
      setError('Phone must be a valid Nigerian number (e.g. 08012345678)');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const { user, tokens } = await authApi.register({ name, email, phone, password });
      await signIn(tokens, user);
      router.replace('/(tabs)');
    } catch (e) {
      setError(apiErrorMessage(e, 'Registration failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.logo}>Create account</Text>
        <Text style={styles.tagline}>Start buying airtime, data & more instantly</Text>
      </View>

      <View style={styles.form}>
        <Field label="Full name" value={name} onChangeText={setName} placeholder="Ada Obi" />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Field
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="08012345678"
          keyboardType="phone-pad"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 characters"
          secureTextEntry={!showPassword}
          rightAccessory={
            <Pressable
              onPress={() => setShowPassword((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={Colors.textMuted}
              />
            </Pressable>
          }
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Create account" onPress={submit} loading={loading} />
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account?</Text>
        <Link href="/(auth)/login" style={styles.link}>
          Sign in
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: Spacing.xxl, gap: Spacing.xs },
  logo: { fontSize: Font.xl, fontWeight: '800', color: Colors.text },
  tagline: { fontSize: Font.sm, color: Colors.textMuted },
  form: { gap: Spacing.lg, marginTop: Spacing.xl },
  error: { color: Colors.danger, fontSize: Font.sm },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.xl },
  footerText: { color: Colors.textMuted },
  link: { color: Colors.primary, fontWeight: '700' },
});
