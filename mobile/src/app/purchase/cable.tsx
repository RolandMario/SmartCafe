import { useMemo, useState } from 'react';
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
} from '../../components/ui';
import BrandBand, { brandRoot, brandSheet } from '../../components/BrandBand';
import { CustomerVerification, CatalogItem } from '../../types';
import { Colors, Font, Radius, Spacing } from '../../constants/theme';
import { formatNaira } from '../../utils/format';
import { computeCashbackPreview } from '../../utils/cashback';

const PROVIDERS = ['DSTV', 'GOTV', 'STARTIMES'] as const;

/** '2025-06-30 00:00:00' (VTPass format) or ISO → '30 Jun 2025' (date only). */
function formatDueDate(value?: string): string {
  if (!value) return '—';
  const text = String(value).trim();
  const date = new Date(text.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return text;
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleString('en-GB', { month: 'short' });
  return `${day} ${month} ${date.getFullYear()}`;
}

export default function CableScreen() {
  const router = useRouter();
  const setDraft = usePurchaseStore((s) => s.setDraft);
  const user = useAuthStore((s) => s.user);
  const { data: packages } = useCatalog('CABLE');
  const [provider, setProvider] = useState<string>('DSTV');
  const [smartCard, setSmartCard] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [customer, setCustomer] = useState<CustomerVerification | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [packageId, setPackageId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const providerPackages = useMemo(
    () => (packages ?? []).filter((p) => p.provider === provider),
    [packages, provider],
  );
  const selected = (packages ?? []).find((p) => p._id === packageId) as
    | CatalogItem
    | undefined;

  const verify = async () => {
    setVerifyError('');
    setCustomer(null);
    if (smartCard.length < 7) {
      setVerifyError('Enter a valid smart card number');
      return;
    }
    setVerifying(true);
    try {
      const result = await serviceApi.cableVerify({
        provider,
        smartCardNumber: smartCard,
      });
      setCustomer(result);
    } catch (e) {
      setVerifyError(apiErrorMessage(e, 'Verification failed'));
    } finally {
      setVerifying(false);
    }
  };

  const changeProvider = (p: string) => {
    if (p === provider) return;
    setProvider(p);
    setPackageId(null);
    setCustomer(null);
    setVerifyError('');
  };

  const changeSmartCard = (text: string) => {
    setSmartCard(text);
    setCustomer(null);
    setVerifyError('');
  };

  /** One-tap renew: reuse the purchase flow with the verified current plan. */
  const renewNow = () => {
    if (!customer) {
      setVerifyError('Verify your smart card first');
      return;
    }
    const plan = customer.renewal;
    if (!plan) {
      setVerifyError(
        'We could not find this plan in the catalogue yet — please pick it below to renew.',
      );
      return;
    }
    setVerifyError('');
    setError('');
    setDraft({
      title: 'Cable TV Renewal',
      subtitle: `${provider} · ${plan.name}`,
      amount: plan.amount,
      cashback: computeCashbackPreview({
        amount: plan.amount,
        commission: plan.commission,
        resellerCommission: plan.resellerCommission,
        role: user?.role,
      }),
      wallet: 'main',
      review: [
        { label: 'Provider', value: provider },
        { label: 'Smart card', value: smartCard },
        { label: 'Customer', value: customer.name },
        { label: 'Plan', value: plan.name },
        ...(customer.currentPlan?.dueDate
          ? [{ label: 'Due date', value: formatDueDate(customer.currentPlan.dueDate) }]
          : []),
        { label: 'Amount', value: formatNaira(plan.amount) },
      ],
      submit: (pin, wallet) =>
        serviceApi.cable(
          { provider, smartCardNumber: smartCard, packageId: plan.packageId },
          pin,
          wallet,
        ),
    });
    router.push('/confirm');
  };

  const continueToConfirm = () => {
    if (!customer) {
      setVerifyError('Verify your smart card first');
      return;
    }
    if (!selected) {
      setError('Select a subscription package');
      return;
    }
    setError('');
    setDraft({
      title: 'Cable TV Subscription',
      subtitle: `${provider} · ${selected.name}`,
      amount: selected.amount ?? 0,
      cashback: computeCashbackPreview({
        amount: selected.amount ?? 0,
        commission: selected.commission,
        resellerCommission: selected.resellerCommission,
        role: user?.role,
      }),
      wallet: 'main',
      review: [
        { label: 'Provider', value: provider },
        { label: 'Smart card', value: smartCard },
        { label: 'Customer', value: customer.name },
        { label: 'Package', value: selected.name },
        { label: 'Amount', value: formatNaira(selected.amount ?? 0) },
      ],
      submit: (pin, wallet) =>
        serviceApi.cable(
          { provider, smartCardNumber: smartCard, packageId: selected._id },
          pin,
          wallet,
        ),
    });
    router.push('/confirm');
  };

  return (
    <View style={brandRoot}>
      <BrandBand title="Cable TV" onBack={() => router.back()} center />

      {/* Light sheet that overlaps the green band — same as the home screen */}
      <View style={brandSheet}>
        <Screen edges={['left', 'right']}>
          <Section title="Provider">
            <OptionChips
              options={PROVIDERS as unknown as string[]}
              value={provider}
              onChange={changeProvider}
              renderLabel={(p) => p}
              variant="primary"
            />
          </Section>

          <Section title="Smart card">
            <Field
              label="Smart card / IUC number"
              value={smartCard}
              onChangeText={changeSmartCard}
              placeholder="e.g. 8123456789"
              keyboardType="number-pad"
              variant="primary"
            />
            <Button
              title={
                verifying
                  ? 'Verifying…'
                  : customer
                    ? 'Customer verified'
                    : 'Verify customer'
              }
              onPress={verify}
              loading={verifying}
              variant={customer ? 'ghost' : 'outline'}
            />
            {verifyError ? (
              <Text style={styles.error}>{verifyError}</Text>
            ) : null}
          </Section>

          {customer?.currentPlan ? (
            <Section title="Current subscription">
              <View style={styles.currentPlanCard}>
                <View style={styles.currentPlanHeader}>
                  <View style={styles.currentPlanBadge}>
                    <Text style={styles.currentPlanBadgeText}>{provider}</Text>
                  </View>
                  <View style={styles.currentPlanDetails}>
                    <Text style={styles.customerName}>{customer.name}</Text>
                    <Text style={styles.currentPlanName}>
                      {customer.currentPlan.name}
                    </Text>
                  </View>
                </View>
                <View style={styles.currentPlanRows}>
                  <View style={styles.currentPlanRow}>
                    <Text style={styles.currentPlanLabel}>Due date</Text>
                    <Text style={styles.currentPlanValue}>
                      {formatDueDate(customer.currentPlan.dueDate)}
                    </Text>
                  </View>
                  <View style={styles.currentPlanRow}>
                    <Text style={styles.currentPlanLabel}>Plan amount</Text>
                    <Text style={styles.currentPlanValue}>
                      {formatNaira(
                        customer.currentPlan.amount ??
                          customer.renewal?.amount ??
                          0,
                      )}
                    </Text>
                  </View>
                </View>
                <Button
                  title="Renew this plan"
                  variant="primary"
                  onPress={renewNow}
                />
              </View>
            </Section>
          ) : null}

          <Section
            title={
              customer?.currentPlan
                ? 'Or choose another package'
                : 'Subscription package'
            }
          >
            <View style={styles.packagesGrid}>
              {providerPackages.map((p) => {
                const active = p._id === packageId;
                return (
                  <Pressable
                    key={p._id}
                    onPress={() => setPackageId(p._id)}
                    style={({ pressed }) => [
                      styles.plan,
                      active && styles.planActive,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={styles.planName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text
                      style={[
                        styles.planPrice,
                        active && styles.planPriceActive,
                      ]}
                    >
                      {formatNaira(p.amount ?? 0)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
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
  packagesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  plan: {
    width: '48%',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: 2,
  },
  planActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  planName: { fontSize: Font.sm, fontWeight: '700', color: Colors.text },
  planPrice: { fontSize: Font.md, fontWeight: '800', color: Colors.primary },
  planPriceActive: { color: Colors.primaryDark },
  currentPlanCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  currentPlanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  currentPlanBadge: {
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  currentPlanBadgeText: {
    color: Colors.primaryDark,
    fontSize: Font.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  currentPlanDetails: { flex: 1, gap: 2 },
  customerName: {
    fontSize: Font.sm,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  currentPlanName: {
    fontSize: Font.lg,
    fontWeight: '800',
    color: Colors.text,
  },
  currentPlanRows: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  currentPlanRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  currentPlanLabel: { fontSize: Font.sm, color: Colors.textMuted },
  currentPlanValue: {
    fontSize: Font.sm,
    fontWeight: '700',
    color: Colors.text,
  },
});
