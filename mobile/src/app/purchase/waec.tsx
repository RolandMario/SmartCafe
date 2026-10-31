import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePurchaseStore } from '../../store/purchase';
import { useAuthStore } from '../../store/auth';
import { serviceApi } from '../../api/service';
import { useCatalog } from '../../api/queries';
import { apiErrorMessage } from '../../api/client';
import { Screen, Button, Field, Section, Card } from '../../components/ui';
import BrandBand, { brandRoot, brandSheet } from '../../components/BrandBand';
import { CatalogItem, CustomerVerification } from '../../types';
import { Colors, Font, Radius, Spacing } from '../../constants/theme';
import { formatNaira } from '../../utils/format';
import { computeCashbackPreview } from '../../utils/cashback';

/** VTPass supports buying more than one registration PIN per request. */
const MAX_QUANTITY = 10;

export default function WaecScreen() {
  const router = useRouter();
  const setDraft = usePurchaseStore((s) => s.setDraft);
  const user = useAuthStore((s) => s.user);
  const { data: products } = useCatalog('WAEC');
  const { data: jambProducts } = useCatalog('JAMB');
  const [productId, setProductId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');
  // JAMB PIN vending state.
  const [jambProductId, setJambProductId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState('');
  const [verifyingProfile, setVerifyingProfile] = useState(false);
  const [jambCustomer, setJambCustomer] = useState<CustomerVerification | null>(
    null,
  );
  const [jambVerifyError, setJambVerifyError] = useState('');
  const [jambError, setJambError] = useState('');

  const product: CatalogItem | undefined = (products ?? []).find(
    (p) => p._id === productId,
  );
  const jambProduct: CatalogItem | undefined = (jambProducts ?? []).find(
    (p) => p._id === jambProductId,
  );
  const isRegistration = product?.productCode === 'waec-registration';
  const unit = product?.amount ?? 0;
  const total = unit * quantity;

  const continueToConfirm = () => {
    if (!product) {
      setError('Select a WAEC product');
      return;
    }
    setError('');
    const review = [
      { label: 'Product', value: product.name },
      ...(isRegistration
        ? [
            {
              label: 'Quantity',
              value: `${quantity} registration PIN${quantity > 1 ? 's' : ''}`,
            },
            { label: 'Unit price', value: formatNaira(unit) },
          ]
        : []),
      { label: 'Amount', value: formatNaira(total) },
    ];
    setDraft({
      title: 'WAEC',
      subtitle: product.name,
      amount: total,
      cashback: computeCashbackPreview({
        amount: unit,
        commission: product.commission,
        resellerCommission: product.resellerCommission,
        role: user?.role,
        quantity: isRegistration ? quantity : 1,
      }),
      wallet: 'main',
      review,
      submit: (pin, wallet) =>
        serviceApi.waec(
          {
            productId: product._id,
            ...(isRegistration ? { quantity } : {}),
          },
          pin,
          wallet,
        ),
    });
    router.push('/confirm');
  };

  const verifyProfile = async () => {
    setJambVerifyError('');
    setJambCustomer(null);
    if (!jambProductId) {
      setJambVerifyError('Select a JAMB PIN type first');
      return;
    }
    if (profileId.trim().length < 4) {
      setJambVerifyError('Enter a valid JAMB profile ID');
      return;
    }
    setVerifyingProfile(true);
    try {
      const result = await serviceApi.jambVerify({
        productId: jambProductId,
        profileId,
      });
      setJambCustomer(result);
    } catch (e) {
      setJambVerifyError(apiErrorMessage(e, 'Verification failed'));
    } finally {
      setVerifyingProfile(false);
    }
  };

  const continueJamb = () => {
    if (!jambCustomer) {
      setJambVerifyError('Verify your JAMB profile ID first');
      return;
    }
    if (!jambProduct) {
      setJambError('Select a JAMB PIN type');
      return;
    }
    setJambError('');
    setDraft({
      title: 'JAMB PIN Vending',
      subtitle: `${jambProduct.name} · ${profileId}`,
      amount: jambProduct.amount ?? 0,
      cashback: computeCashbackPreview({
        amount: jambProduct.amount ?? 0,
        commission: jambProduct.commission,
        resellerCommission: jambProduct.resellerCommission,
        role: user?.role,
      }),
      wallet: 'main',
      review: [
        { label: 'Product', value: jambProduct.name },
        { label: 'Profile ID', value: profileId },
        { label: 'Candidate', value: jambCustomer.name },
        { label: 'Amount', value: formatNaira(jambProduct.amount ?? 0) },
      ],
      submit: (pin, wallet) =>
        serviceApi.jamb({ productId: jambProduct._id, profileId }, pin, wallet),
    });
    router.push('/confirm');
  };

  return (
    <View style={brandRoot}>
      <BrandBand
        title="WAEC & JAMB Services"
        onBack={() => router.back()}
        center
      />

      {/* Light sheet that overlaps the green band — same as the home screen */}
      <View style={brandSheet}>
        <Screen edges={['left', 'right']}>
          <Section title="Choose product">
            {(products ?? []).map((p) => {
              const active = p._id === productId;
              return (
                <Pressable
                  key={p._id}
                  onPress={() => {
                    setProductId(p._id);
                    if (p.productCode !== 'waec-registration') setQuantity(1);
                  }}
                >
                  <Card style={[styles.plan, active && styles.planActive]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.planName}>{p.name}</Text>
                      <Text style={styles.muted}>
                        {p.productCode === 'waec-registration'
                          ? 'Registration PIN & serial — complete registration on the WAEC portal'
                          : 'Instant PIN & serial delivery'}
                      </Text>
                    </View>
                    <Text style={styles.planPrice}>
                      {formatNaira(p.amount ?? 0)}
                    </Text>
                  </Card>
                </Pressable>
              );
            })}
          </Section>

          {isRegistration ? (
            <Section title="How many registration PINs?">
              <View style={styles.stepperRow}>
                <Pressable
                  accessibilityLabel="Decrease quantity"
                  style={[
                    styles.stepperBtn,
                    quantity <= 1 && styles.stepperBtnDisabled,
                  ]}
                  disabled={quantity <= 1}
                  onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                >
                  <Text style={styles.stepperBtnText}>−</Text>
                </Pressable>
                <View style={styles.stepperValueWrap}>
                  <Text style={styles.stepperValue}>{quantity}</Text>
                  <Text style={styles.muted}>
                    registration PIN{quantity > 1 ? 's' : ''}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Increase quantity"
                  style={[
                    styles.stepperBtn,
                    quantity >= MAX_QUANTITY && styles.stepperBtnDisabled,
                  ]}
                  disabled={quantity >= MAX_QUANTITY}
                  onPress={() =>
                    setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))
                  }
                >
                  <Text style={styles.stepperBtnText}>+</Text>
                </Pressable>
              </View>
              <Card style={styles.totalCard}>
                <Text style={styles.muted}>
                  {formatNaira(unit)} × {quantity} ={' '}
                  <Text style={styles.totalStrong}>{formatNaira(total)}</Text>
                </Text>
              </Card>
            </Section>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title="Continue"
            variant="primary"
            onPress={continueToConfirm}
          />

          <View style={styles.divider} />

          <Section title="JAMB PIN Vending">
            <Text style={styles.muted}>
              Buy a UTME / Direct Entry registration PIN and receive it
              instantly. Enter your JAMB profile ID (from the JAMB portal) to
              verify your details first.
            </Text>
            {(jambProducts ?? []).map((p) => {
              const active = p._id === jambProductId;
              return (
                <Pressable
                  key={p._id}
                  onPress={() => {
                    setJambProductId(p._id);
                    setJambError('');
                  }}
                >
                  <Card style={[styles.plan, active && styles.planActive]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.planName}>{p.name}</Text>
                      <Text style={styles.muted}>
                        {p.productCode === 'utme-mock'
                          ? 'Includes the JAMB mock exam'
                          : 'Standard UTME / Direct Entry PIN'}
                      </Text>
                    </View>
                    <Text style={styles.planPrice}>
                      {formatNaira(p.amount ?? 0)}
                    </Text>
                  </Card>
                </Pressable>
              );
            })}
            <Field
              label="JAMB profile ID"
              value={profileId}
              onChangeText={(t) => {
                setProfileId(t);
                setJambVerifyError('');
              }}
              placeholder="e.g. 23456789AB"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={14}
            />
            <Button
              title={
                verifyingProfile
                  ? 'Verifying…'
                  : jambCustomer
                    ? 'Customer: ' + jambCustomer.name
                    : 'Verify profile ID'
              }
              onPress={verifyProfile}
              loading={verifyingProfile}
              variant={jambCustomer ? 'ghost' : 'outline'}
            />
            {jambVerifyError ? (
              <Text style={styles.error}>{jambVerifyError}</Text>
            ) : null}
            {jambError ? <Text style={styles.error}>{jambError}</Text> : null}
            <Button
              title="Buy JAMB PIN"
              variant="primary"
              onPress={continueJamb}
            />
          </Section>

          <Button title="Back" variant="ghost" onPress={() => router.back()} />
        </Screen>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: Font.xs, color: Colors.textMuted },
  error: { color: Colors.danger, fontSize: Font.sm },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginVertical: Spacing.xl,
  },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  planActive: {
    borderColor: Colors.purple,
    borderWidth: 2,
    backgroundColor: Colors.purpleSoft,
  },
  planName: { fontSize: Font.md, fontWeight: '700', color: Colors.text },
  planPrice: { fontSize: Font.md, fontWeight: '800', color: Colors.purple },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  stepperBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.purpleSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnDisabled: { opacity: 0.4 },
  stepperBtnText: {
    fontSize: Font.xl,
    fontWeight: '800',
    color: Colors.purple,
  },
  stepperValueWrap: { flex: 1, alignItems: 'center' },
  stepperValue: { fontSize: Font.xxl, fontWeight: '800', color: Colors.text },
  totalCard: { marginTop: Spacing.md, backgroundColor: Colors.purpleSoft },
  totalStrong: { fontWeight: '800', color: Colors.purple },
});
