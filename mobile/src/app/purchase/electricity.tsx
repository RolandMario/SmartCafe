import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePurchaseStore } from '../../store/purchase';
import { useAuthStore } from '../../store/auth';
import { serviceApi } from '../../api/service';
import { useCatalog } from '../../api/queries';
import { apiErrorMessage } from '../../api/client';
import {
  Screen,
  Button,
  Field,
  Section,
  OptionChips,
  Select,
} from '../../components/ui';
import BrandBand, { brandRoot, brandSheet } from '../../components/BrandBand';
import { CustomerVerification, CatalogItem } from '../../types';
import { Colors, Font, Radius, Spacing } from '../../constants/theme';
import { formatNaira } from '../../utils/format';
import { computeCashbackPreview } from '../../utils/cashback';

const METER_TYPES = ['prepaid', 'postpaid'] as const;

/** Quick-select default amounts (₦ each) — all above the ₦500 minimum. */
const QUICK_AMOUNTS = [500, 1000, 2000, 5000, 10000, 20000];

export default function ElectricityScreen() {
  const router = useRouter();
  const setDraft = usePurchaseStore((s) => s.setDraft);
  const user = useAuthStore((s) => s.user);
  const { data: discos } = useCatalog('ELECTRICITY');
  const [discoId, setDiscoId] = useState<string | null>(null);
  const [meterType, setMeterType] = useState<string>('prepaid');
  const [meterNumber, setMeterNumber] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [customer, setCustomer] = useState<CustomerVerification | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const selectedDisco: CatalogItem | undefined = (discos ?? []).find(
    (d) => d._id === discoId,
  );

  const discoOptions = (discos ?? []).map((d) => ({
    value: d._id,
    label: d.providerLabel,
  }));

  const changeDisco = (id: string) => {
    setDiscoId(id);
    // A different disco means the previously verified meter no longer applies.
    setCustomer(null);
    setVerifyError('');
  };

  const verify = async () => {
    setVerifyError('');
    setCustomer(null);
    if (!discoId) {
      setVerifyError('Select a distribution company');
      return;
    }
    if (meterNumber.length < 6) {
      setVerifyError('Enter a valid meter number');
      return;
    }
    setVerifying(true);
    try {
      const result = await serviceApi.electricityVerify({
        disco: selectedDisco?.provider ?? '',
        meterNumber,
        meterType,
      });
      setCustomer(result);
    } catch (e) {
      setVerifyError(apiErrorMessage(e, 'Verification failed'));
    } finally {
      setVerifying(false);
    }
  };

  const continueToConfirm = () => {
    const amt = Number(amount);
    if (!customer) {
      setVerifyError('Verify your meter first');
      return;
    }
    if (!amt || amt < 500) {
      setError('Enter an amount of at least ₦500');
      return;
    }
    setError('');
    setDraft({
      title: 'Electricity Bill Payment',
      subtitle: `${selectedDisco?.providerLabel ?? ''} · ${meterNumber}`,
      amount: amt,
      cashback: computeCashbackPreview({
        amount: amt,
        commission: selectedDisco?.commission,
        resellerCommission: selectedDisco?.resellerCommission,
        role: user?.role,
      }),
      wallet: 'main',
      review: [
        { label: 'Disco', value: selectedDisco?.providerLabel ?? '' },
        { label: 'Meter type', value: meterType },
        { label: 'Meter number', value: meterNumber },
        { label: 'Customer', value: customer.name },
        { label: 'Amount', value: formatNaira(amt) },
      ],
      submit: (pin, wallet) =>
        serviceApi.electricity(
          {
            disco: selectedDisco?.provider ?? '',
            meterNumber,
            meterType,
            amount: amt,
          },
          pin,
          wallet,
        ),
    });
    router.push('/confirm');
  };

  return (
    <View style={brandRoot}>
      <BrandBand title="Electricity" onBack={() => router.back()} center />

      {/* Light sheet that overlaps the green band — same as the home screen */}
      <View style={brandSheet}>
        <Screen edges={['left', 'right']}>
          <Section title="Distribution company">
            {discos ? (
              <Select<string>
                placeholder="Choose a distribution company"
                value={discoId}
                options={discoOptions}
                onChange={changeDisco}
                variant="primary"
              />
            ) : (
              <Text style={styles.muted}>Loading distribution companies…</Text>
            )}
          </Section>

          <Section title="Meter details">
            <OptionChips
              options={METER_TYPES as unknown as string[]}
              value={meterType}
              onChange={setMeterType}
              renderLabel={(t) => t}
              variant="primary"
            />
            <Field
              label="Meter number"
              value={meterNumber}
              onChangeText={setMeterNumber}
              placeholder="e.g. 04210123456"
              keyboardType="number-pad"
              variant="primary"
            />
            <Button
              title={
                verifying
                  ? 'Verifying…'
                  : customer
                    ? 'Customer: ' + customer.name
                    : 'Verify meter'
              }
              onPress={verify}
              loading={verifying}
              variant={customer ? 'ghost' : 'outline'}
            />
            {verifyError ? (
              <Text style={styles.error}>{verifyError}</Text>
            ) : null}
          </Section>

          <Section title="Amount">
            <View style={styles.amountGrid}>
              {QUICK_AMOUNTS.map((v) => {
                const active = Number(amount) === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => {
                      setAmount(String(v));
                      setError('');
                    }}
                    style={({ pressed }) => [
                      styles.amountCard,
                      active && styles.amountCardActive,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.amountValue,
                        active && styles.amountValueActive,
                      ]}
                    >
                      {formatNaira(v)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Field
              label="Or enter a custom amount (₦)"
              value={amount}
              onChangeText={setAmount}
              placeholder="e.g. 7500"
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
  muted: { color: Colors.textMuted, fontSize: Font.sm },
  error: { color: Colors.danger, fontSize: Font.sm },
  amountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  amountCard: {
    width: '31%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  amountCardActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  amountValue: { fontSize: Font.md, fontWeight: '800', color: Colors.primary },
  amountValueActive: { color: Colors.primary },
});
