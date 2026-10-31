import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePurchaseStore } from '../../store/purchase';
import { useAuthStore } from '../../store/auth';
import { serviceApi } from '../../api/service';
import {
  Screen,
  Button,
  Field,
  Section,
  OptionChips,
} from '../../components/ui';
import PhoneField from '../../components/PhoneField';
import BrandBand, { brandRoot, brandSheet } from '../../components/BrandBand';
import { Colors, Font, Spacing } from '../../constants/theme';
import { formatNaira, isValidNigerianPhone } from '../../utils/format';

export const NETWORKS = ['MTN', 'AIRTEL', 'GLO', '9MOBILE'] as const;

export default function AirtimeScreen() {
  const router = useRouter();
  const setDraft = usePurchaseStore((s) => s.setDraft);
  const user = useAuthStore((s) => s.user);
  const [network, setNetwork] = useState<string>('MTN');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const continueToConfirm = () => {
    const amt = Number(amount);
    if (!isValidNigerianPhone(phone)) {
      setError('Enter a valid Nigerian phone number');
      return;
    }
    if (!amt || amt < 50) {
      setError('Enter an amount of at least ₦50');
      return;
    }
    setError('');
    setDraft({
      title: 'Buy Airtime',
      subtitle: `${network} · ${phone}`,
      amount: amt,
      wallet: 'main',
      review: [
        { label: 'Network', value: network },
        { label: 'Phone', value: phone },
        { label: 'Amount', value: formatNaira(amt) },
      ],
      submit: (pin, wallet) =>
        serviceApi.airtime({ network, phone, amount: amt }, pin, wallet),
    });
    router.push('/confirm');
  };

  return (
    <View style={brandRoot}>
      <BrandBand title="Buy Airtime" onBack={() => router.back()} center />

      {/* Light sheet that overlaps the green band — same as the home screen */}
      <View style={brandSheet}>
        <Screen edges={['left', 'right']}>
          <Section title="Network">
            <OptionChips
              options={NETWORKS as unknown as string[]}
              value={network}
              onChange={setNetwork}
              renderLabel={(n) => n}
              variant="primary"
            />
          </Section>

          <Section title="Phone number">
            <PhoneField
              label="Recipient phone"
              value={phone}
              onChangeText={setPhone}
              placeholder="08012345678"
              keyboardType="phone-pad"
              maxLength={14}
              variant="primary"
            />
          </Section>

          <Section title="Amount">
            <View style={styles.quick}>
              {[100, 200, 500, 1000].map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setAmount(String(v))}
                  style={[
                    styles.quickChip,
                    amount === String(v) && styles.quickChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.quickText,
                      amount === String(v) && styles.quickTextActive,
                    ]}
                  >
                    {formatNaira(v)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Field
              label="Amount (₦)"
              value={amount}
              onChangeText={setAmount}
              placeholder="e.g. 500"
              keyboardType="number-pad"
              variant="primary"
            />
          </Section>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title="Continue"
            variant="primary"
            onPress={continueToConfirm}
          />
          <Button title="Back" variant="ghost" onPress={() => router.back()} />
        </Screen>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: Colors.danger, fontSize: Font.sm },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  quickChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  quickChipActive: {
    backgroundColor: Colors.primarySoft,
    borderColor: Colors.primary,
  },
  quickText: { color: Colors.textMuted, fontWeight: '700' },
  quickTextActive: { color: Colors.primary },
});
