import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { Button } from './ui';
import { SmartCafeLogo } from './Receipt';
import { Colors, Font, Radius, Spacing } from '../constants/theme';
import { formatDate, formatNaira } from '../utils/format';
import { FundingStatus } from '../types';

type ShareFormat = 'image' | 'text';

interface FundingReceiptData {
  name: string;
  phone: string;
  amount: number;
  reference: string;
  transferReference?: string;
  createdAt?: string;
  /** Current state of the funding request — drives the receipt's status pill. */
  status?: FundingStatus;
}

/** Status pill copy/colour per funding state. */
const STATUS_STYLE: Record<FundingStatus, { label: string; color: string }> = {
  pending: { label: 'PENDING VERIFICATION', color: Colors.warning },
  credited: { label: 'CREDITED', color: Colors.success },
  failed: { label: 'DECLINED', color: Colors.danger },
};

/** Plain-text rendition used by the native share fallback (SMS, email, …). */
function buildReceiptText(d: FundingReceiptData): string {
  const lines = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '      SMARTCAFE · FUNDING RECEIPT',
    '   Cashback Funding (bank transfer)',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    `Registered name: ${d.name}`,
    `Registered phone: ${d.phone}`,
    `Transfer amount: ${formatNaira(d.amount)}`,
    `Reference: ${d.reference}`,
  ];
  if (d.transferReference) lines.push(`Transfer reference: ${d.transferReference}`);
  lines.push(`Date / time: ${formatDate(d.createdAt)}`, '');
  lines.push(
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Thank you for using SmartCafe.',
  );
  return lines.join('\n');
}

/**
 * Receipt shown (and shareable) once a Cashback Funding request is created —
 * the user made a bank transfer to the company account and keyed in its
 * transfer reference. Shares a PNG snapshot of the receipt card, or the same
 * details as plain text. Mirrors the purchase-receipt sharing flow.
 */
export function FundingReceipt(props: FundingReceiptData) {
  const contentRef = useRef<View>(null);
  const [chooserVisible, setChooserVisible] = useState(false);

  // The format sheet is a native <Modal>. iOS silently refuses to present the
  // share sheet (Share.share / expo-sharing) while the modal is still
  // animating out, so the share must start only once the modal is fully
  // dismissed. We use the Modal's onDismiss callback (iOS) backed by a
  // fallback timer for Android, which has no onDismiss callback.
  const pendingFormatRef = useRef<ShareFormat | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showShareError = useCallback(() => {
    Alert.alert('Share failed', 'We could not share the receipt right now. Please try again.');
  }, []);

  const shareImage = useCallback(async () => {
    const uri = await captureRef(contentRef, { format: 'png', quality: 1, result: 'tmpfile' });
    const fileUri = uri.startsWith('file:') ? uri : `file://${uri}`;
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(fileUri, {
      dialogTitle: 'Share funding receipt',
      mimeType: 'image/png',
      UTI: 'public.png',
    });
  }, []);

  const shareText = useCallback(async () => {
    await Share.share({ message: buildReceiptText(props), title: 'SmartCafe Funding Receipt' });
  }, [props]);

  const launchShare = useCallback(
    (format: ShareFormat) => {
      pendingFormatRef.current = null;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      void (format === 'image' ? shareImage() : shareText()).catch(showShareError);
    },
    [shareImage, shareText, showShareError],
  );

  const selectFormat = useCallback(
    (format: ShareFormat) => {
      pendingFormatRef.current = format;
      setChooserVisible(false);
      // Android's Modal never fires onDismiss, so this timer guarantees the
      // pending share still runs once the sheet has left the screen. On iOS the
      // onDismiss callback normally wins this race and clears the timer.
      pendingTimerRef.current = setTimeout(() => {
        if (pendingFormatRef.current) launchShare(pendingFormatRef.current);
      }, 600);
    },
    [launchShare],
  );

  const handleSheetDismiss = useCallback(() => {
    if (pendingFormatRef.current) launchShare(pendingFormatRef.current);
  }, [launchShare]);

  // Clear any pending fallback timer if the component unmounts mid-flow.
  useEffect(
    () => () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    },
    [],
  );

  const pill = STATUS_STYLE[props.status ?? 'pending'];

  return (
    <View style={styles.card}>
      {/* The receipt card is snapshotted as the shareable PNG — keep the share
          button outside this view so it never appears in the image. */}
      <View ref={contentRef} collapsable={false} style={styles.capturable}>
        <View style={[styles.header, { backgroundColor: Colors.header }]}>
          <SmartCafeLogo size={52} />
          <Text style={styles.appName}>
            Smart<Text style={styles.appNameGold}>Pay</Text>
          </Text>
          <Text style={styles.tagline}>Cashback Funding Receipt</Text>
          <View style={[styles.statusPill, { backgroundColor: pill.color }]}>
            <Text style={styles.statusText}>{pill.label}</Text>
          </View>
        </View>

        <View style={styles.rows}>
          <ReceiptRow label="Registered name" value={props.name || '—'} />
          <ReceiptRow label="Registered phone" value={props.phone || '—'} />
          <ReceiptRow label="Transfer amount" value={formatNaira(props.amount)} strong />
          <ReceiptRow label="Reference" value={props.reference} />
          {props.transferReference ? (
            <ReceiptRow label="Transfer reference" value={props.transferReference} />
          ) : null}
          <ReceiptRow label="Date / time" value={formatDate(props.createdAt) || '—'} />
        </View>

        <View style={styles.divider} />

        <Text style={styles.footer}>
          Our team verifies your transfer and credits your wallet shortly. Keep your reference handy.
        </Text>
      </View>

      <View style={styles.shareWrap}>
        <Button
          title="Share receipt"
          variant="outline"
          onPress={() => setChooserVisible(true)}
        />
      </View>

      <ShareFormatSheet
        visible={chooserVisible}
        onClose={() => setChooserVisible(false)}
        onSelect={selectFormat}
        onDismiss={handleSheetDismiss}
      />
    </View>
  );
}

/**
 * Centered modal that pops the funding receipt over the current screen — used
 * right after a cashback (bank-transfer) funding request is created, and again
 * from the History screen when a top-up row is tapped.
 */
export function FundingReceiptModal({
  visible,
  data,
  onClose,
}: {
  visible: boolean;
  data: FundingReceiptData;
  onClose: () => void;
}) {
  const status = data.status ?? 'pending';
  const headline =
    status === 'credited'
      ? 'Wallet funded ✅'
      : status === 'failed'
        ? 'Funding request declined'
        : 'Request submitted ✅';
  const subtitle =
    status === 'credited'
      ? 'This top-up has been credited to your wallet.'
      : status === 'failed'
        ? 'Our team could not verify this funding request. Contact support if you think this is a mistake.'
        : 'Our team is verifying your transfer — here is your receipt. Share it with us if needed.';
  const icon = status === 'failed' ? 'close-circle' : 'checkmark-circle';
  const iconColor = status === 'failed' ? Colors.danger : Colors.success;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView
            contentContainerStyle={styles.modalContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.modalHeader}>
              <Ionicons name={icon} size={44} color={iconColor} />
              <Text style={styles.modalTitle}>{headline}</Text>
              <Text style={styles.modalSubtitle}>{subtitle}</Text>
            </View>

            <FundingReceipt {...data} />

            <Button title="Done" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Bottom sheet asking how the funding receipt should be shared. */
function ShareFormatSheet({
  visible,
  onClose,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (format: ShareFormat) => void;
  /** iOS only — fires once the modal has fully animated out. */
  onDismiss?: () => void;
}) {
  const options: {
    format: ShareFormat;
    icon: ComponentProps<typeof Ionicons>['name'];
    label: string;
    hint: string;
  }[] = [
    {
      format: 'image',
      icon: 'image-outline',
      label: 'Share as image',
      hint: 'PNG photo — great for WhatsApp, email…',
    },
    {
      format: 'text',
      icon: 'chatbox-ellipses-outline',
      label: 'Share as text',
      hint: 'Plain text for SMS, email…',
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetCard} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.sheetTitle}>Share receipt</Text>
          <Text style={styles.sheetSubtitle}>Choose how you want to share it</Text>
          {options.map((option) => (
            <Pressable
              key={option.format}
              onPress={() => onSelect(option.format)}
              style={({ pressed }) => [styles.sheetOption, pressed && styles.sheetOptionPressed]}
            >
              <View style={styles.sheetOptionIcon}>
                <Ionicons name={option.icon} size={20} color={Colors.primary} />
              </View>
              <View style={styles.sheetOptionText}>
                <Text style={styles.sheetOptionLabel}>{option.label}</Text>
                <Text style={styles.sheetOptionHint}>{option.hint}</Text>
              </View>
            </Pressable>
          ))}
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ReceiptRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowValueStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  // Solid background on the captured area keeps the shared PNG opaque (no
  // transparency / stray borders around text, per react-native-view-shot docs).
  capturable: { backgroundColor: Colors.surface },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  appName: { fontSize: Font.xl, fontWeight: '800', color: Colors.white, letterSpacing: 0.5 },
  appNameGold: { color: Colors.gold },
  tagline: { fontSize: Font.xs, color: 'rgba(255,255,255,0.85)' },
  statusPill: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  statusText: { fontSize: Font.xs, fontWeight: '800', color: Colors.white, letterSpacing: 1 },
  rows: { gap: Spacing.sm, padding: Spacing.xl },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  rowLabel: { color: Colors.textMuted, fontSize: Font.sm, flexShrink: 1 },
  rowValue: {
    color: Colors.text,
    fontSize: Font.sm,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  rowValueStrong: { fontWeight: '800', color: Colors.primaryDark },
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.border, borderStyle: 'dashed' },
  footer: {
    fontSize: Font.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  shareWrap: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg },

  // Centered receipt modal.
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    backgroundColor: Colors.background,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    maxHeight: '92%',
  },
  modalContent: { padding: Spacing.lg, gap: Spacing.lg },
  modalHeader: { alignItems: 'center', gap: Spacing.xs },
  modalTitle: {
    fontSize: Font.lg,
    fontWeight: '800',
    color: Colors.text,
    marginTop: Spacing.xs,
  },
  modalSubtitle: {
    fontSize: Font.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: Spacing.sm,
  },

  // Share-format bottom sheet.
  sheetBackdrop: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  sheetTitle: { fontSize: Font.lg, fontWeight: '800', color: Colors.text },
  sheetSubtitle: { fontSize: Font.sm, color: Colors.textMuted, marginBottom: Spacing.xs },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  sheetOptionPressed: { backgroundColor: Colors.primarySoft },
  sheetOptionIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptionText: { flex: 1, gap: 2 },
  sheetOptionLabel: { fontSize: Font.md, fontWeight: '700', color: Colors.text },
  sheetOptionHint: { fontSize: Font.xs, color: Colors.textMuted },
});