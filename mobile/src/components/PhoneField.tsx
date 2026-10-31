import { ComponentProps, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import {
  Contact,
  ContactField,
  getPermissionsAsync,
  requestPermissionsAsync,
} from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import { Field } from './ui';
import { Colors } from '../constants/theme';
import { isValidNigerianPhone, normalizeContactPhone } from '../utils/format';

type PhoneFieldProps = Omit<ComponentProps<typeof Field>, 'rightAccessory' | 'error'> & {
  error?: string;
  /** Called with the normalised number once a contact is picked. */
  onPicked?: (phone: string) => void;
};

/**
 * Phone number input with a contacts button on the right. Tapping the button
 * requests contacts permission and opens the native contact picker; the first
 * number on the chosen contact is normalised to a Nigerian 0-prefixed number
 * and written into the field.
 *
 * Works on iOS/Android (expo-contacts). On web the button shows an inline
 * notice instead of attempting the picker.
 */
export default function PhoneField({
  label,
  error,
  onPicked,
  ...props
}: PhoneFieldProps) {
  const [picking, setPicking] = useState(false);
  const [contactError, setContactError] = useState('');

  const pickFromContacts = async () => {
    setContactError('');
    if (Platform.OS === 'web') {
      setContactError('Contact picking is only available in the mobile app.');
      return;
    }
    setPicking(true);
    try {
      const { status } = await getPermissionsAsync();
      if (status !== 'granted') {
        const requested = await requestPermissionsAsync();
        if (requested.status !== 'granted') {
          setContactError('Contacts permission is required to pick a number.');
          return;
        }
      }
      const contact = await Contact.presentPicker();
      if (contact) {
        const details = await contact.getDetails([ContactField.PHONES]);
        const raw = details.phones?.find((p) => p.number)?.number;
        if (!raw) {
          setContactError('That contact has no phone number.');
          return;
        }
        const normalized = normalizeContactPhone(raw);
        if (!normalized) {
          setContactError('Could not read the contact phone number.');
          return;
        }
        if (!isValidNigerianPhone(normalized)) {
          setContactError('Picked number is not a Nigerian mobile number — please check it.');
        }
        props.onChangeText?.(normalized);
        onPicked?.(normalized);
      }
    } catch {
      // User cancelled the native picker or the module is unavailable — no error.
    } finally {
      setPicking(false);
    }
  };

  return (
    <Field
      label={label}
      error={contactError || error}
      rightAccessory={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pick from contacts"
          onPress={pickFromContacts}
          disabled={picking}
          hitSlop={8}
        >
          <Ionicons
            name={picking ? 'hourglass-outline' : 'person-add-outline'}
            size={22}
            color={Colors.primary}
          />
        </Pressable>
      }
      {...props}
    />
  );
}