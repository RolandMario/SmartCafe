import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { usePurchaseStore } from '../../store/purchase';
import { serviceApi } from '../../api/service';
import { useSmsQuote } from '../../api/queries';
import { Screen, Button, Field, Section, Card } from '../../components/ui';
import BrandBand, { brandRoot, brandSheet } from '../../components/BrandBand';
import { formatNaira, isValidNigerianPhone } from '../../utils/format';
import { Colors, Font, Spacing } from '../../constants/theme';

// ebulksms billing model: 1 unit per recipient per 160-char page,
// hard maximum of 4 pages (612 chars). See https://www.ebulksms.com/pages/json-api
export const SMS_PAGE_LENGTH = 160;
export const SMS_MAX_MESSAGE = 612;
export const smsPages = (messageLength: number) =>
  Math.max(1, Math.ceil(messageLength / SMS_PAGE_LENGTH));

/** Splits comma / semicolon / whitespace separated numbers into a clean one-per-line block. */
const normalizeRecipients = (text: string): string =>
  text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n');

/** Reads the text content of a file picked via expo-document-picker. */
async function readPickedTextFile(
  asset: DocumentPicker.DocumentPickerAsset,
): Promise<string> {
  // Web exposes the raw File object; native assets (copied to cache) use a local file:// URI.
  if (Platform.OS === 'web' && asset.file) return asset.file.text();
  const res = await fetch(asset.uri);
  return res.text();
}

const IMPORT_FILE_TYPES = [
  'text/plain',
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'text/*',
];

export default function SmsScreen() {
  const router = useRouter();
  const setDraft = usePurchaseStore((s) => s.setDraft);
  const [senderName, setSenderName] = useState('');
  const [message, setMessage] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState('');
  const [error, setError] = useState('');

  const recipients = useMemo(
    () => normalizeRecipients(recipientsText).split('\n'),
    [recipientsText],
  );
  const validRecipients = recipients.filter(isValidNigerianPhone);
  const invalidCount = recipients.length - validRecipients.length;
  const pages = smsPages(message.length);
  const { data: quote } = useSmsQuote(validRecipients.length, message.length);
  const fallbackAmount = Math.ceil(validRecipients.length * pages * 2.5);

  const handleRecipientsChange = (text: string) => {
    setImportNotice('');
    // Pasting (or typing) comma / semicolon separated numbers → arrange one per line.
    setRecipientsText(/[,;]/.test(text) ? normalizeRecipients(text) : text);
  };

  const importRecipientsFile = async () => {
    setImporting(true);
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: IMPORT_FILE_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || result.assets.length === 0) return;
      const imported = normalizeRecipients(
        await readPickedTextFile(result.assets[0]),
      );
      if (!imported) {
        setError(
          'No phone numbers found in that file. Use a .txt or .csv where numbers are separated by commas or new lines.',
        );
        return;
      }
      setRecipientsText((prev) => {
        const existing = normalizeRecipients(prev);
        return existing ? `${existing}\n${imported}` : imported;
      });
      setImportNotice(`Uploaded ${imported.split('\n').length} number(s)`);
    } catch {
      setError(
        'Could not read that file. Pick a .txt or .csv file with phone numbers separated by commas.',
      );
    } finally {
      setImporting(false);
    }
  };

  const continueToConfirm = () => {
    if (!/^[a-zA-Z0-9]{3,11}$/.test(senderName)) {
      setError('Sender ID must be 3-11 alphanumeric characters');
      return;
    }
    if (!message.trim()) {
      setError('Enter your message');
      return;
    }
    if (validRecipients.length === 0) {
      setError('Enter at least one valid Nigerian phone number');
      return;
    }
    if (invalidCount > 0) {
      setError(`${invalidCount} invalid number(s) removed`);
      return;
    }
    const amount = quote?.amount ?? fallbackAmount;
    setError('');
    setDraft({
      title: 'Bulk SMS',
      subtitle: `${validRecipients.length} recipient(s) · ${senderName}`,
      amount,
      wallet: 'main',
      review: [
        { label: 'Sender ID', value: senderName },
        { label: 'Recipients', value: String(validRecipients.length) },
        { label: 'Message preview', value: message.slice(0, 60) },
        { label: 'Estimated cost', value: formatNaira(amount) },
      ],
      submit: (pin, wallet) =>
        serviceApi.sms(
          { senderName, message, recipients: validRecipients },
          pin,
          wallet,
        ),
    });
    router.push('/confirm');
  };

  return (
    <View style={brandRoot}>
      <BrandBand title="Bulk SMS" onBack={() => router.back()} center />

      {/* Light sheet that overlaps the green band — same as the home screen */}
      <View style={brandSheet}>
        <Screen edges={['left', 'right']}>
          <Section title="Campaign">
            <Field
              label="Sender ID (alphanumeric)"
              value={senderName}
              onChangeText={setSenderName}
              placeholder="MyBrand"
              autoCapitalize="characters"
              maxLength={11}
            />
            <Field
              label="Message"
              value={message}
              onChangeText={setMessage}
              placeholder="Type your message…"
              multiline
              numberOfLines={4}
              maxLength={SMS_MAX_MESSAGE}
              style={{ minHeight: 100, textAlignVertical: 'top' }}
            />
            <Field
              label="Recipients (one per line)"
              value={recipientsText}
              onChangeText={handleRecipientsChange}
              placeholder={'08012345678\n08098765432'}
              multiline
              numberOfLines={4}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ minHeight: 100, textAlignVertical: 'top' }}
            />
            <Text style={styles.hint}>
              Paste comma-separated numbers (e.g. 08012345678,08098765432) and
              they will be arranged one per line — or upload a list file.
            </Text>
            <Button
              title="Upload phone-list file"
              variant="outline"
              onPress={importRecipientsFile}
              loading={importing}
            />
            {importNotice ? (
              <Text style={styles.success}>{importNotice}</Text>
            ) : null}
          </Section>

          <Card style={{ backgroundColor: Colors.tealSoft }}>
            <Text style={styles.costLine}>
              Valid numbers:{' '}
              <Text style={styles.costStrong}>{validRecipients.length}</Text>
              {invalidCount > 0 ? (
                <Text style={styles.warn}> ({invalidCount} invalid)</Text>
              ) : null}
            </Text>
            <Text style={styles.costLine}>
              Message: <Text style={styles.costStrong}>{message.length}</Text>/
              {SMS_MAX_MESSAGE} chars ·{' '}
              <Text style={styles.costStrong}>{pages}</Text> page
              {pages > 1 ? 's' : ''}
              {pages > 1 ? ' (multi-page costs more)' : null}
            </Text>
            <Text style={styles.costLine}>
              Estimated cost:{' '}
              <Text style={styles.costStrong}>
                {formatNaira(quote?.amount ?? fallbackAmount)}
              </Text>
            </Text>
          </Card>

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
  hint: { fontSize: Font.xs, color: Colors.textMuted, marginTop: -Spacing.sm },
  success: { color: Colors.success, fontSize: Font.xs, fontWeight: '600' },
  costLine: { fontSize: Font.sm, color: Colors.textMuted },
  costStrong: { fontWeight: '800', color: Colors.teal },
  warn: { color: Colors.warning },
});
