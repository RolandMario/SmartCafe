import { useEffect, useState } from 'react';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../store/auth';
import { authApi } from '../../api/service';
import { apiErrorMessage } from '../../api/client';
import { Screen, Button, Field } from '../../components/ui';
import { Colors, Font, Radius, Spacing } from '../../constants/theme';
import {
  clearSavedCredentials,
  loadSavedCredentials,
  saveCredentials,
} from '../../store/rememberMe';
import BrandHeader from '@/components/BrandHeader';

export default function LoginScreen() {
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);
  const { reset: resetParam } = useLocalSearchParams<{ reset?: string }>();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remember, setRemember] = useState(false);

  // Pre-fill the form with saved credentials when "Remember me" was used.
  useEffect(() => {
    void loadSavedCredentials().then((saved) => {
      if (saved) {
        setIdentifier(saved.identifier);
        setPassword(saved.password);
        setRemember(true);
      }
    });
  }, []);

  // Turning "Remember me" off also wipes any stored credentials.
  const toggleRemember = () => {
    setRemember((prev) => {
      const next = !prev;
      if (!next) void clearSavedCredentials();
      return next;
    });
  };

  const submit = async () => {
    setError('');
    if (!identifier || !password) {
      setError('Enter your email/phone and password');
      return;
    }
    setLoading(true);
    try {
      const { user, tokens } = await authApi.login({ identifier, password });
      await signIn(tokens, user);
      if (remember) {
        await saveCredentials(identifier, password);
      } else {
        await clearSavedCredentials();
      }
      router.replace('/(tabs)');
    } catch (e) {
      setError(apiErrorMessage(e, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <BrandHeader/>
      </View>

      <View style={styles.form}>
        <Field
          label="Email or Phone"
          value={identifier}
          onChangeText={setIdentifier}
          placeholder="you@example.com or 08012345678"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Enter your password"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
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
        <View style={styles.optionsRow}>
          <Pressable style={styles.rememberRow} onPress={toggleRemember} hitSlop={8}>
            <Ionicons
              name={remember ? 'checkbox' : 'square-outline'}
              size={22}
              color={remember ? Colors.primary : Colors.textMuted}
            />
            <Text style={styles.rememberText}>Remember me</Text>
          </Pressable>
          <Link href="/(auth)/forgot-password" style={styles.link}>
            Forgot password?
          </Link>
        </View>
        {resetParam === 'done' ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Password reset successfully. Sign in with your new password.</Text>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Sign in" onPress={submit} loading={loading} />
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Don&apos;t have an account?</Text>
        <Link href="/(auth)/register" style={styles.link}>
          Create one
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: Spacing.xxl, gap: Spacing.xs },
  logo: { fontSize: Font.xxl, fontWeight: '800', color: Colors.primary },
  tagline: { fontSize: Font.sm, color: Colors.textMuted },
  form: { gap: Spacing.lg, marginTop: Spacing.xl },
  optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rememberText: { color: Colors.textMuted, fontSize: Font.sm, fontWeight: '600' },
  error: { color: Colors.danger, fontSize: Font.sm },
  banner: { backgroundColor: Colors.successSoft, borderRadius: Radius.md, padding: Spacing.md },
  bannerText: { color: Colors.success, fontSize: Font.sm, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.xl },
  footerText: { color: Colors.textMuted },
  link: { color: Colors.primary, fontWeight: '700' },
});
