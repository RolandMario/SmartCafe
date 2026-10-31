import { useState } from 'react';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../store/auth';
import { authApi } from '../../api/service';
import { useBalance } from '../../api/queries';
import { apiErrorMessage } from '../../api/client';
import { Screen, Button, Card, Section, Field } from '../../components/ui';
import { DvaCard } from '../../components/DvaCard';
import BrandBand, { brandRoot, brandSheet } from '../../components/BrandBand';
import { Colors, Font, Spacing } from '../../constants/theme';
import { formatNaira } from '../../utils/format';

export default function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, accessToken, signOut } = useAuthStore();
  const { data: balance } = useBalance();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState('');

  const updateProfile = useMutation({
    mutationFn: () => authApi.updateProfile({ name, phone }),
    onSuccess: (updated) => {
      useAuthStore.setState({ user: updated });
      setEditing(false);
      setMsg('Profile updated');
      void queryClient.invalidateQueries();
    },
  });

  const deleteAccount = useMutation({
    mutationFn: () => authApi.deleteAccount(),
    onSuccess: async () => {
      await signOut();
      queryClient.clear();
      router.replace('/(auth)/login');
    },
  });

  const isAdmin = user?.role === 'admin';
  const roleLabel =
    user?.role === 'reseller' ? 'Reseller' : isAdmin ? 'Administrator' : 'Customer';

  const doSignOut = async () => {
    await signOut();
    queryClient.clear();
    router.replace('/(auth)/login');
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This will permanently delete your account, wallet and transaction history. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => deleteAccount.mutate(),
        },
      ],
    );
  };

  return (
    <View style={brandRoot}>
      <BrandBand title="Profile" />

      {/* Light sheet that overlaps the green band — same as the home screen */}
      <View style={brandSheet}>
        <Screen edges={['left', 'right']}>
          <Card>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.muted}>{user?.email}</Text>
            <Text style={styles.muted}>{user?.phone}</Text>
            <View style={styles.badgeRow}>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>
                  {roleLabel}
                </Text>
              </View>
            </View>
          </Card>

          <Section title="Cashback">
            <Card style={{ gap: Spacing.xs }}>
              <Text style={styles.cashbackValue}>
                {formatNaira(balance?.cashbackBalance ?? 0)}
              </Text>
              <Text style={styles.muted}>
                Cashback is earned on successful purchases and can be used to
                pay for future ones. It cannot be withdrawn.
              </Text>
            </Card>
          </Section>

          <Section title="Bank transfer">
            {/* Personal Paystack account number for wallet top-ups by transfer. */}
            <DvaCard />
          </Section>

          <Section title="Edit details">
            {editing ? (
              <>
                <Field label="Full name" value={name} onChangeText={setName} />
                <Field
                  label="Phone"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
                {msg ? <Text style={styles.success}>{msg}</Text> : null}
                <Button
                  title="Save"
                  onPress={() => updateProfile.mutate()}
                  loading={updateProfile.isPending}
                />
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => setEditing(false)}
                />
              </>
            ) : (
              <Button
                title="Edit details"
                variant="ghost"
                style={{ backgroundColor: Colors.white }}
                textStyle={{ color: Colors.black }}
                onPress={() => setEditing(true)}
              />
            )}
            {updateProfile.isError ? (
              <Text style={styles.error}>
                {apiErrorMessage(updateProfile.error)}
              </Text>
            ) : null}
          </Section>

          <Section title="Security">
            <Button
              title="Set / change transaction PIN"
              variant="primarySoft"
              textStyle={{ color: Colors.black }}
              onPress={() => router.push('/pin')}
            />
          </Section>

          <Section title="Support">
            <Button
              title="Contact support"
              variant="primarySoft"
              onPress={() =>
                Linking.openURL('https://digitalsmartenvironment.com/contact')
              }
            />
          </Section>

          <Section title="Account">
            <Button
              title="Top up wallet"
              variant="primarySoft"
              onPress={() => router.push('/fund')}
            />
            {isAdmin ? (
              <Button
                title="Open Admin Dashboard"
                variant="ghost"
                onPress={() => {
                  // The admin SPA runs separately (Next.js, default http://localhost:3000).
                  // eslint-disable-next-line no-console
                  console.log('Admin dashboard: http://localhost:3000');
                }}
              />
            ) : null}
            {accessToken ? (
              <Text style={styles.mutedSmall}>Session: signed in</Text>
            ) : null}
            <Button
              title="Sign out"
              variant="danger"
              onPress={() => doSignOut()}
            />
            <Button
              title="Delete account"
              variant="danger"
              onPress={confirmDeleteAccount}
              loading={deleteAccount.isPending}
              style={{
                backgroundColor: Colors.dangerSoft,
                borderWidth: 1,
                borderColor: Colors.danger,
              }}
              textStyle={{ color: Colors.danger }}
            />
            {deleteAccount.isError ? (
              <Text style={styles.error}>
                {apiErrorMessage(deleteAccount.error)}
              </Text>
            ) : null}
          </Section>
        </Screen>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: Font.lg, fontWeight: '800', color: Colors.text },
  muted: { fontSize: Font.sm, color: Colors.textMuted },
  cashbackValue: {
    fontSize: Font.xl,
    fontWeight: '800',
    color: Colors.success,
  },
  mutedSmall: { fontSize: Font.xs, color: Colors.textMuted },
  badgeRow: { marginTop: Spacing.sm },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: 999,
  },
  roleText: { color: Colors.primaryDark, fontWeight: '700', fontSize: Font.xs },
  success: { color: Colors.success, fontSize: Font.sm },
  error: { color: Colors.danger, fontSize: Font.sm },
});
