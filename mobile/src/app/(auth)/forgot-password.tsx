import { useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { authApi } from '../../api/service';
import { apiErrorMessage } from '../../api/client';
import { Screen, Button, Field } from '../../components/ui';
import { Colors, Font, Radius, Spacing } from '../../constants/theme';

type Stage = 'request' | 'reset';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const requestCode = async () => {
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address');
      return;
    }
    setLoading(true);
    try {
      const { message } = await authApi.forgotPassword(email.trim());
      setNotice(message);
      setStage('reset');
    } catch (e) {
      setError(apiErrorMessage(e, 'Could not request a reset code'));
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async () => {
    setError('');
    if (code.trim().length < 6) {
      setError('Enter the 6-digit code from your email');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await authApi.resetPassword({ email: email.trim(), code: code.trim(), newPassword });
      router.replace({ pathname: '/(auth)/login', params: { reset: 'done' } });
    } catch (e) {
      setError(apiErrorMessage(e, 'Password reset failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.logo}>{stage === 'request' ? 'Forgot password?' : 'Reset password'}</Text>
        <Text style={styles.tagline}>
          {stage === 'request'
            ? 'Enter your account email and we will email you a 6-digit verification code.'
            : `Enter the code sent to ${email} and choose a new password.`}
        </Text>
      </View>

      <View style={styles.form}>
        {stage === 'request' ? (
          <>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Send verification code" onPress={requestCode} loading={loading} />
            <Button title="Back to sign in" variant="ghost" onPress={() => router.replace('/(auth)/login')} />
          </>
        ) : (
          <>
            {notice ? (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>{notice}</Text>
              </View>
            ) : null}
            <Field
              label="Verification code"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={6}
            />
            <Field
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="At least 8 characters"
              secureTextEntry
            />
            <Field
              label="Confirm new password"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Repeat new password"
              secureTextEntry
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Reset password" onPress={submitReset} loading={loading} />
            <Button title="Resend code" variant="outline" onPress={requestCode} loading={loading} />
            <Button title="Back to sign in" variant="ghost" onPress={() => router.replace('/(auth)/login')} />
          </>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Remembered it?</Text>
        <Link href="/(auth)/login" style={styles.link}>
          Sign in
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: Spacing.xxl, gap: Spacing.xs },
  logo: { fontSize: Font.xl, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  tagline: { fontSize: Font.sm, color: Colors.textMuted, textAlign: 'center' },
  form: { gap: Spacing.lg, marginTop: Spacing.xl },
  error: { color: Colors.danger, fontSize: Font.sm },
  banner: { backgroundColor: Colors.successSoft, borderRadius: Radius.md, padding: Spacing.md },
  bannerText: { color: Colors.success, fontSize: Font.sm, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.xl },
  footerText: { color: Colors.textMuted },
  link: { color: Colors.primary, fontWeight: '700' },
});