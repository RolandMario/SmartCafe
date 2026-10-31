import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Pressable, StyleSheet, Text, View, Platform } from 'react-native';
import { usePurchaseStore } from '../../store/purchase';
import { useAuthStore } from '../../store/auth';
import { serviceApi } from '../../api/service';
import { useCatalog } from '../../api/queries';
import { Screen, Button, Section, OptionChips } from '../../components/ui';
import PhoneField from '../../components/PhoneField';
import BrandBand, { brandRoot, brandSheet } from '../../components/BrandBand';
import { NETWORKS } from './airtime';
import { Colors, Font, Radius, Spacing } from '../../constants/theme';
import { formatNaira, isValidNigerianPhone } from '../../utils/format';
import { computeCashbackPreview } from '../../utils/cashback';
import { CatalogItem } from '../../types';

/** "All durations" filter bucket key. */
const ALL_DURATIONS = 'ALL';

/** Turn a validity-in-days number into a human-friendly label. */
function validityLabel(days?: number): string {
  const d = days ?? 30;
  if (d === 1) return 'Daily';
  if (d === 7) return '7 days';
  if (d % 30 === 0) {
    const months = d / 30;
    return `${months} month${months > 1 ? 's' : ''}`;
  }
  return `${d} days`;
}

export default function DataScreen() {
  const router = useRouter();
  const setDraft = usePurchaseStore((s) => s.setDraft);
  const user = useAuthStore((s) => s.user);
  const { data: plans } = useCatalog('DATA');
  const [network, setNetwork] = useState<string>('MTN');
  const [duration, setDuration] = useState<string>(ALL_DURATIONS);
  const [planId, setPlanId] = useState<string | null>(null);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [error, setError] = useState('');

  const networkPlans = useMemo(
    () => (plans ?? []).filter((p) => p.provider === network),
    [plans, network],
  );

  // Distinct validity durations present for the current network (e.g. 1, 7, 30 days).
  const durationOptions = useMemo(() => {
    const set = new Set<number>();
    for (const p of networkPlans) set.add(p.validityDays ?? 30);
    return [...set].sort((a, b) => a - b);
  }, [networkPlans]);

  const visiblePlans = useMemo(() => {
    if (duration === ALL_DURATIONS) return networkPlans;
    const days = Number(duration);
    return networkPlans.filter((p) => (p.validityDays ?? 30) === days);
  }, [networkPlans, duration]);

  // Keep the selection valid when the network or duration filter hides a plan.
  // Derived-state adjustment in render (React docs pattern) keeps <planId> in
  // sync with the visible plans without calling setState inside an effect.
  const [previousVisiblePlans, setPreviousVisiblePlans] =
    useState(visiblePlans);
  if (previousVisiblePlans !== visiblePlans) {
    setPreviousVisiblePlans(visiblePlans);
    if (planId && !visiblePlans.some((p) => p._id === planId)) {
      setPlanId(null);
    }
  }

  const selectedPlan: CatalogItem | undefined = (plans ?? []).find(
    (p) => p._id === planId,
  );

  const continueToConfirm = () => {
    if (!selectedPlan) {
      setError('Select a data bundle');
      return;
    }
    if (!isValidNigerianPhone(phone)) {
      setError('Enter a valid Nigerian phone number');
      return;
    }
    setError('');
    setDraft({
      title: 'Buy Data',
      subtitle: `${network} · ${selectedPlan.name}`,
      amount: selectedPlan.amount ?? 0,
      cashback: computeCashbackPreview({
        amount: selectedPlan.amount ?? 0,
        commission: selectedPlan.commission,
        resellerCommission: selectedPlan.resellerCommission,
        role: user?.role,
      }),
      wallet: 'main',
      review: [
        { label: 'Network', value: network },
        { label: 'Bundle', value: selectedPlan.name },
        { label: 'Validity', value: validityLabel(selectedPlan.validityDays) },
        { label: 'Phone', value: phone },
        { label: 'Amount', value: formatNaira(selectedPlan.amount ?? 0) },
      ],
      submit: (pin, wallet) =>
        serviceApi.data({ planId: selectedPlan._id, phone }, pin, wallet),
    });
    router.push('/confirm');
  };

  const changeNetwork = (n: string) => {
    setNetwork(n);
    setPlanId(null);
    setDuration(ALL_DURATIONS);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0} // adjust for header/nav bar
    >
    <View style={brandRoot}>
      <BrandBand title="Buy Data" onBack={() => router.back()} center />

      {/* Light sheet that overlaps the green band — same as the home screen */}
      <View style={brandSheet}>
        <Screen edges={['left', 'right']}>
          <Section title="Network">
            <OptionChips
              options={NETWORKS as unknown as string[]}
              value={network}
              onChange={changeNetwork}
              renderLabel={(n) => n}
              variant="primary"
            />
          </Section>

          <Section title="Duration">
            <OptionChips
              options={[ALL_DURATIONS, ...durationOptions.map(String)]}
              value={duration}
              onChange={setDuration}
              renderLabel={(v) =>
                v === ALL_DURATIONS ? 'All' : validityLabel(Number(v))
              }
              variant="primary"
            />
          </Section>

          <Section title="Choose bundle">
            <View style={styles.grid}>
              {visiblePlans.map((p) => {
                const active = p._id === planId;
                const cashback = computeCashbackPreview({
                  amount: p.amount ?? 0,
                  commission: p.commission,
                  resellerCommission: p.resellerCommission,
                  role: user?.role ?? null,
                });
                return (
                  <Pressable
                    key={p._id}
                    onPress={() => {
                      setPlanId(p._id);
                      setError('');
                    }}
                    style={({ pressed }) => [
                      styles.gridItem,
                      active && styles.gridItemActive,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={styles.planName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={styles.planValidity}>
                      {validityLabel(p.validityDays)}
                    </Text>
                    <Text
                      style={[
                        styles.planPrice,
                        active && styles.planPriceActive,
                      ]}
                    >
                      {formatNaira(p.amount ?? 0)}
                    </Text>
                    {cashback > 0 ? (
                      <Text style={styles.planCashback} numberOfLines={1}>
                        +{formatNaira(cashback)} cb
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
              {visiblePlans.length === 0 ? (
                <Text style={styles.emptyText}>
                  No bundles for this duration.
                </Text>
              ) : null}
            </View>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  error: { color: Colors.danger, fontSize: Font.sm },
  emptyText: { color: Colors.textMuted, fontSize: Font.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  // Three cards per row: 3 × 31% + the two 8px gaps stays under 100% on
  // every phone width, so exactly three bundles fit on each line.
  gridItem: {
    width: '31%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: 2,
  },
  gridItemActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  planName: { fontSize: Font.sm, fontWeight: '700', color: Colors.text },
  planValidity: { fontSize: Font.xs, color: Colors.textMuted },
  planPrice: { fontSize: Font.md, fontWeight: '800', color: Colors.primary },
  planPriceActive: { color: Colors.primary },
  // Purple, bold cashback bonus shown on every bundle card — the amount reflects
  // the buyer's role (resellers earn at the higher resellerCommission rate).
  planCashback: { color: Colors.purple, fontSize: Font.sm, fontWeight: '800' },
});
