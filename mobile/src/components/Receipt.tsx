import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentProps, type RefObject } from 'react';
import {
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File as FileSystemFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { Button } from './ui';
import { SERVICE_BY_TYPE } from '../constants/services';
import { Colors, Font, Radius, Spacing } from '../constants/theme';
import { formatNaira, formatDate } from '../utils/format';
import { buildReceiptText } from '../utils/receipt';
import { buildReceiptPdf } from '../utils/receiptPdf';
import { useAuthStore } from '../store/auth';
import { useBalance } from '../api/queries';
import { Transaction } from '../types';
import logo from '../../assets/images/smartcafe.png';

/** SmartCafe brand mark — a coffee cup in a rounded badge. */
export function SmartCafeLogo({
  size = 52,
  variant = 'light',
}: {
  size?: number;
  /** 'light' = solid white badge (for the colored receipt header); 'brand' = solid brand color (for light/white backgrounds). */
  variant?: 'light' | 'brand';
}) {
  return (
    <View
      style={[
        styles.logoBadge,
        variant === 'brand' && styles.logoBadgeBrand,
        { width: size, height: size, borderRadius: size * 0.28 },
      ]}
    >
      <Image
        source={logo}
        style={{ width: size * 2, height: size * 2}}
        resizeMode="contain"
      />
    </View>
  );
}

function statusText(txn: Transaction): { label: string; color: string } {
  if (txn.status === 'success') return { label: 'SUCCESSFUL', color: Colors.success };
  if (txn.status === 'pending') return { label: 'PROCESSING', color: Colors.warning };
  return { label: 'FAILED', color: Colors.danger };
}

/** Formats the receipt can be shared in: a PNG snapshot of the receipt card, the branded A4 PDF, or plain text. */
export type ReceiptShareFormat = 'image' | 'pdf' | 'text';

export interface ReceiptShareMeta {
  userName?: string;
  phone?: string;
  walletAfter?: number;
}

export interface ReceiptHandle {
  /**
   * Opens the share-format sheet (image / PDF / text). Pass `format` to skip the
   * sheet and share directly in that format.
   */
  share: (format?: ReceiptShareFormat) => void;
}

function receiptRefCode(txn: Transaction): string {
  return (txn.reference || txn._id || 'receipt').replace(/[^a-zA-Z0-9-_]/g, '');
}

function receiptPdfName(txn: Transaction): string {
  return `SmartCafe-Receipt-${receiptRefCode(txn)}.pdf`;
}

function receiptImageName(txn: Transaction): string {
  return `SmartCafe-Receipt-${receiptRefCode(txn)}.png`;
}

/** Generates the branded receipt PDF in the cache directory so the share sheet can attach it. */
async function buildPdfFile(txn: Transaction, meta: ReceiptShareMeta): Promise<FileSystemFile> {
  const bytes = await buildReceiptPdf(txn, meta);
  const file = new FileSystemFile(Paths.cache, receiptPdfName(txn));
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file;
}

/**
 * Snapshots the rendered receipt card to a PNG (tmpfile in the cache directory)
 * and returns the file URI plus the display name to share.
 */
async function captureReceiptImage(
  viewRef: RefObject<View | null>,
  txn: Transaction,
): Promise<{ uri: string; name: string }> {
  const name = receiptImageName(txn);
  const uri = await captureRef(viewRef, { format: 'png', quality: 1, result: 'tmpfile' });
  return { uri: uri.startsWith('file:') ? uri : `file://${uri}`, name };
}

async function shareText(txn: Transaction, meta: ReceiptShareMeta): Promise<void> {
  await Share.share({ message: buildReceiptText(txn, meta), title: 'SmartCafe Receipt' });
}

/**
 * Shares a local file (PNG image or PDF) through the native share sheet. Uses
 * expo-sharing because RN's Android Share module is text-only (ACTION_SEND +
 * text/plain) and cannot attach a file.
 */
async function shareNativeFile(uri: string, format: 'image' | 'pdf'): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const isImage = format === 'image';
  await Sharing.shareAsync(uri, {
    dialogTitle: 'Share receipt',
    mimeType: isImage ? 'image/png' : 'application/pdf',
    UTI: isImage ? 'public.png' : 'com.adobe.pdf',
  });
}

/** Shares a browser File via the Web Share API, or downloads it as a fallback. */
async function webShareFile(file: File, name: string): Promise<void> {
  const nav = navigator as any;
  if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] }) && typeof nav.share === 'function') {
    await nav.share({ files: [file], title: 'SmartCafe Receipt' });
    return;
  }
  // No file-sharing support — download the file instead.
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareWebPdf(txn: Transaction, meta: ReceiptShareMeta): Promise<void> {
  try {
    const bytes = await buildReceiptPdf(txn, meta);
    const file = new File(
      [new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })],
      receiptPdfName(txn),
      { type: 'application/pdf' },
    );
    await webShareFile(file, receiptPdfName(txn));
  } catch {
    // PDF build/sharing failed — fall back to the plain-text share / clipboard behaviour.
    await shareWebText(txn, meta);
  }
}

async function shareWebImage(image: { uri: string; name: string }): Promise<void> {
  // Errors propagate to shareReceiptInFormat, which falls back to text sharing.
  const blob = await (await fetch(image.uri)).blob();
  const file = new File([blob], image.name, { type: 'image/png' });
  await webShareFile(file, image.name);
}

async function shareWebText(txn: Transaction, meta: ReceiptShareMeta): Promise<void> {
  try {
    const nav = navigator as any;
    const text = buildReceiptText(txn, meta);
    if (nav?.share) {
      await nav.share({ title: 'SmartCafe Receipt', text });
      return;
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      Alert.alert('Receipt copied', 'Your SmartCafe receipt was copied to the clipboard.');
    }
  } catch {
    // User dismissed the share sheet — nothing to do.
  }
}

/**
 * Shares the receipt in the requested format. `image` renders the on-screen
 * receipt card as a PNG, `pdf` renders the branded A4 document, and `text`
 * sends the readable plain-text rendition (handy for SMS/email fallbacks).
 */
async function shareReceiptInFormat(
  viewRef: RefObject<View | null>,
  txn: Transaction,
  meta: ReceiptShareMeta,
  format: ReceiptShareFormat,
): Promise<void> {
  try {
    if (format === 'text') {
      if (Platform.OS === 'web') await shareWebText(txn, meta);
      else await shareText(txn, meta);
      return;
    }

    if (Platform.OS === 'web') {
      if (format === 'pdf') {
        await shareWebPdf(txn, meta);
      } else {
        await shareWebImage(await captureReceiptImage(viewRef, txn));
      }
      return;
    }

    // iOS / Android
    if (format === 'pdf') {
      await shareNativeFile((await buildPdfFile(txn, meta)).uri, 'pdf');
    } else {
      await shareNativeFile((await captureReceiptImage(viewRef, txn)).uri, 'image');
    }
  } catch {
    // Capture or file sharing failed (e.g. very old device) — fall back to text.
    if (Platform.OS === 'web') await shareWebText(txn, meta);
    else await shareText(txn, meta);
  }
}

interface ReceiptProps {
  transaction: Transaction;
  /** When false the in-card "Share receipt" button is hidden (e.g. the post-purchase screen places it next to Done). */
  showShareButton?: boolean;
}

const Receipt = forwardRef<ReceiptHandle, ReceiptProps>(function Receipt(
  { transaction: txn, showShareButton = true },
  ref,
) {
  const user = useAuthStore((s) => s.user);
  const { data: balance } = useBalance();
  const [chooserVisible, setChooserVisible] = useState(false);
  const contentRef = useRef<View>(null);
  const svc = SERVICE_BY_TYPE[txn.service];
  const pm = txn.providerMeta ?? {};
  const { label: statusLabel, color: statusColor } = statusText(txn);
  const walletAfter = balance?.balance;
  const total = (txn.amount ?? 0) + (txn.commission ?? 0);

  const shareMeta = useMemo<ReceiptShareMeta>(
    () => ({ userName: user?.name, phone: user?.phone, walletAfter }),
    [user?.name, user?.phone, walletAfter],
  );

  // The format sheet is a native <Modal>. iOS silently refuses to present the
  // share sheet (Share.share / expo-sharing) while the modal is still animating
  // out, so the share must start only once the modal is fully dismissed. We use
  // the Modal's onDismiss callback (iOS) backed by a fallback timer for Android,
  // which has no onDismiss callback.
  const pendingFormatRef = useRef<ReceiptShareFormat | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showShareError = useCallback(() => {
    Alert.alert('Share failed', 'We could not share the receipt right now. Please try again.');
  }, []);

  const launchShare = useCallback(
    (format: ReceiptShareFormat) => {
      pendingFormatRef.current = null;
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      void shareReceiptInFormat(contentRef, txn, shareMeta, format).catch(showShareError);
    },
    [txn, shareMeta, showShareError],
  );

  const selectFormat = useCallback(
    (format: ReceiptShareFormat) => {
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

  useImperativeHandle(
    ref,
    () => ({
      share: (format?: ReceiptShareFormat) => {
        if (format) launchShare(format);
        else setChooserVisible(true);
      },
    }),
    [launchShare],
  );

  const providerRows: { label: string; value: string }[] = [];

  // Service-specific fields straight from the API/vendor response (stored in
  // providerMeta / meta): product name + phone for cable; product name,
  // customer name, customer address and token for electricity.
  if (txn.service === 'CABLE') {
    const cableProduct = pm.productName ?? txn.meta?.plan;
    if (cableProduct) {
      providerRows.push({ label: 'Product', value: String(cableProduct) });
    }
    const cablePhone = pm.phone ?? txn.meta?.phone;
    if (cablePhone) {
      providerRows.push({ label: 'Phone', value: String(cablePhone) });
    }
    if (pm.customerName) {
      providerRows.push({ label: 'Customer name', value: String(pm.customerName) });
    }
  } else if (txn.service === 'ELECTRICITY') {
    const electricityProduct = pm.productName ?? txn.meta?.discoLabel;
    if (electricityProduct) {
      providerRows.push({ label: 'Product', value: String(electricityProduct) });
    }
    if (pm.customerName) {
      providerRows.push({ label: 'Customer name', value: String(pm.customerName) });
    }
    const customerAddress = pm.customerAddress ?? pm.address;
    if (customerAddress) {
      providerRows.push({ label: 'Customer address', value: String(customerAddress) });
    }
    // The main token is what the customer keys into the meter — make it the
    // primary row. Bonus/balance tokens are shown when the vendor supplies them.
    const mainToken = pm.mainToken ?? pm.token;
    if (mainToken) {
      providerRows.push({ label: 'ELECTRICITY TOKEN', value: String(mainToken) });
    }
    if (pm.bonusToken) {
      providerRows.push({ label: 'Bonus token', value: String(pm.bonusToken) });
    }
    if (pm.balanceToken) {
      providerRows.push({ label: 'Balance token', value: String(pm.balanceToken) });
    }
    if (pm.units != null) providerRows.push({ label: 'Units purchased', value: String(pm.units) });
  } else if (txn.service === 'JAMB') {
    const jambProduct = pm.productName ?? txn.meta?.product;
    if (jambProduct) providerRows.push({ label: 'Product', value: String(jambProduct) });
    const profileId = pm.profileId ?? txn.meta?.profileId;
    if (profileId) providerRows.push({ label: 'Profile ID', value: String(profileId) });
    if (pm.pin) providerRows.push({ label: 'JAMB PIN', value: String(pm.pin) });
  } else {
    if (pm.quantity != null && Number(pm.quantity) > 1) {
      providerRows.push({ label: 'Quantity', value: `${pm.quantity} PINs` });
    }
    if (pm.pin) {
      providerRows.push({ label: 'WAEC PIN', value: String(pm.pin) });
      if (pm.serial) providerRows.push({ label: 'Serial', value: String(pm.serial) });
    }
    if (Array.isArray(pm.pins)) {
      (pm.pins as string[]).forEach((p, i) =>
        providerRows.push({ label: i === 0 ? 'REGISTRATION PIN' : '', value: p }),
      );
      if (pm.candidateName) providerRows.push({ label: 'Candidate', value: String(pm.candidateName) });
    }
    if (pm.customerName && !pm.pin && !pm.pins) {
      providerRows.push({ label: 'Recipient', value: String(pm.customerName) });
    }
    if (txn.meta?.phone) providerRows.push({ label: 'Recipient phone', value: String(txn.meta.phone) });
  }

  // Shared fields available on every receipt.
  if (txn.meta?.providerLabel) providerRows.push({ label: 'Provider', value: String(txn.meta.providerLabel) });
  if (txn.meta?.smartCardNumber) providerRows.push({ label: 'Smart card', value: String(txn.meta.smartCardNumber) });
  if (txn.meta?.meterNumber) providerRows.push({ label: 'Meter', value: String(txn.meta.meterNumber) });
  if (txn.failureReason) providerRows.push({ label: 'Reason', value: txn.failureReason });

  return (
    <View style={styles.card}>
      {/* The receipt card and rows are snapshotted as the shareable PNG — keep
          the share button outside this view so it never appears in the image. */}
      <View ref={contentRef} collapsable={false} style={styles.capturable}>
        {/* Brand header — colored background, centered */}
        <View style={[styles.header, { backgroundColor: Colors.header }]}>
          <SmartCafeLogo size={52} />
          <Text style={styles.appName}>
            Smart<Text style={styles.appNameGold}>Pay</Text>
          </Text>
          <Text style={styles.tagline}>Virtual Top-Up & Bills Payment</Text>
          <View style={[styles.statusPill, { backgroundColor: statusColor }]}>
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
        </View>

        {/* Receipt details */}
        <View style={styles.rows}>
          <ReceiptRow label="User name" value={user?.name ?? '—'} />
          <ReceiptRow label="Service" value={svc?.label ?? txn.service} />
          <ReceiptRow label="Reference" value={txn.reference} selectable />
          <ReceiptRow label="Amount paid" value={formatNaira(txn.amount)} strong />
          {txn.paymentWallet === 'cashback' ? (
            <ReceiptRow label="Cashback used" value={formatNaira(txn.amount)} />
          ) : null}
          {txn.status === 'success' && (txn.cashback ?? 0) > 0 ? (
            <ReceiptRow label="Cashback earned" value={formatNaira(txn.cashback ?? 0)} strong />
          ) : null}
          <ReceiptRow label="Date" value={formatDate(txn.createdAt)} />
          <ReceiptRow label="Phone number" value={user?.phone ?? '—'} />
          <ReceiptRow
            label="Wallet balance after"
            value={walletAfter != null ? formatNaira(walletAfter) : '—'}
          />
        </View>

        {/* Provider-specific rows (tokens, PINs, recipients…) */}
        {providerRows.length ? (
          <>
            <View style={styles.divider} />
            <View style={styles.rows}>
              {providerRows.map((r, i) => (
                <ReceiptRow
                  key={`${r.label}-${i}`}
                  label={r.label}
                  value={r.value}
                  selectable
                  strong={!r.label}
                />
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.divider} />

        {/* Total */}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>{formatNaira(total)}</Text>
        </View>

        <Text style={styles.footer}>Thank you for using SmartCafe.</Text>
      </View>

      {showShareButton ? (
        <View style={styles.shareWrap}>
          <Button
            title="Share receipt"
            variant="outline"
            onPress={() => {
              setChooserVisible(true);
            }}
          />
        </View>
      ) : null}

      <ShareFormatSheet
        visible={chooserVisible}
        onClose={() => setChooserVisible(false)}
        onSelect={selectFormat}
        onDismiss={handleSheetDismiss}
      />
    </View>
  );
});

export default Receipt;

/** Bottom sheet asking which format the receipt should be shared in. */
function ShareFormatSheet({
  visible,
  onClose,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (format: ReceiptShareFormat) => void;
  /** iOS only — fires once the modal has fully animated out. */
  onDismiss?: () => void;
}) {
  const options: {
    format: ReceiptShareFormat;
    icon: ComponentProps<typeof Ionicons>['name'];
    label: string;
    hint: string;
  }[] = [
    { format: 'image', icon: 'image-outline', label: 'Share as image', hint: 'PNG photo — great for WhatsApp, email…' },
    { format: 'pdf', icon: 'document-text-outline', label: 'Share as PDF', hint: 'Printable A4 document' },
    { format: 'text', icon: 'chatbox-ellipses-outline', label: 'Share as text', hint: 'Plain text for SMS, email…' },
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
  selectable = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  selectable?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text selectable={selectable} style={[styles.rowValue, strong && styles.rowValueStrong]}>
        {value}
      </Text>
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
  logoBadge: {
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  logoBadgeBrand: {
    // backgroundColor: Colors.primary,
  },
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
  divider: { borderBottomWidth: 1, borderBottomColor: Colors.border, borderStyle: 'dashed' },
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
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  totalLabel: { fontSize: Font.lg, fontWeight: '800', color: Colors.text },
  totalValue: { fontSize: Font.xl, fontWeight: '800', color: Colors.primary },
  footer: {
    fontSize: Font.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  shareWrap: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl },

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

