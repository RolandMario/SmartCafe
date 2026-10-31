import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { Colors, Font, Radius, Spacing } from '../constants/theme';

/** Soft palette keys derived from theme.ts (primary/success/warning/danger/purple/teal). */
type SoftVariant =
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'purple'
  | 'teal';

/** Maps a soft variant to its pastel background and bold accent color. */
const SOFT_THEMES: Record<SoftVariant, { bg: string; accent: string }> = {
  primary: { bg: Colors.primarySoft, accent: Colors.primary },
  success: { bg: Colors.successSoft, accent: Colors.success },
  warning: { bg: Colors.warningSoft, accent: Colors.warning },
  danger: { bg: Colors.dangerSoft, accent: Colors.danger },
  purple: { bg: Colors.purpleSoft, accent: Colors.purple },
  teal: { bg: Colors.tealSoft, accent: Colors.teal },
};

export function Screen({
  children,
  scroll = true,
  style,
  edges = ['top', 'left', 'right'],
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Safe-area edges to pad. Screens nested inside a brand band's sheet drop 'top'. */
  edges?: Edge[];
}) {
  const content = <View style={[styles.screen, style]}>{children}</View>;
  return scroll ? (
    <SafeAreaView style={styles.safe} edges={edges}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // iOS: keep the focused input above the on-screen keyboard (boosts the
        // content inset by the keyboard overlap and scrolls the field into view).
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {content}
      </ScrollView>
    </SafeAreaView>
  ) : (
    <SafeAreaView style={styles.safe} edges={edges}>
      {content}
    </SafeAreaView>
  );
}

type ButtonVariant =
  | 'primary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | `${SoftVariant}Soft`;

const SOFT_BUTTON_FG: Record<SoftVariant, string> = {
  primary: Colors.primaryDark,
  success: Colors.success,
  warning: Colors.warning,
  danger: Colors.danger,
  purple: Colors.purple,
  teal: Colors.teal,
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  block = true,
  style,
  textStyle,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const softVariant = variant.endsWith('Soft')
    ? (variant.slice(0, -4) as SoftVariant)
    : null;
  const bg = softVariant
    ? SOFT_THEMES[softVariant].bg
    : variant === 'primary'
      ? Colors.primary
      : variant === 'danger'
        ? Colors.danger
        : 'transparent';
  const borderColor =
    variant === 'outline'
      ? Colors.primary
      : variant === 'danger'
        ? 'transparent'
        : 'transparent';
  const fg = softVariant
    ? SOFT_BUTTON_FG[softVariant]
    : variant === 'primary' || variant === 'danger'
      ? Colors.white
      : variant === 'outline'
        ? Colors.primary
        : Colors.textMuted;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor,
          borderWidth: variant === 'outline' ? 1.5 : 0,
        },
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && { opacity: 0.85 },
        !block && { alignSelf: 'flex-start', paddingHorizontal: Spacing.xl },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }, textStyle]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  rightAccessory,
  variant = 'default',
  style,
  ref,
  ...props
}: TextInputProps & {
  label: string;
  error?: string;
  rightAccessory?: React.ReactNode;
  variant?: SoftVariant | 'default';
  ref?: React.Ref<TextInput>;
}) {
  const theme = variant === 'default' ? null : SOFT_THEMES[variant];
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.inputWrap}>
        <TextInput
          ref={ref}
          placeholderTextColor={theme ? theme.accent : Colors.textMuted}
          style={[
            styles.input,
            theme && { backgroundColor: theme.bg, borderWidth: 0 },
            rightAccessory ? styles.inputWithAccessory : null,
            error ? { borderColor: Colors.danger, borderWidth: 1 } : null,
            style,
          ]}
          {...props}
        />
        {rightAccessory ? (
          <View style={styles.inputAccessory}>{rightAccessory}</View>
        ) : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function Card({
  children,
  style,
  title,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Optional heading rendered above the card contents. */
  title?: string;
}) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export interface SelectOption<T> {
  value: T;
  label: string;
  sublabel?: string;
}

/**
 * Dropdown select field: tapping the field expands the option list inline;
 * picking an option closes the list and makes it the active (checked) value.
 */
export function Select<T>({
  label,
  placeholder = 'Select…',
  value,
  options,
  onChange,
  variant = 'default',
}: {
  label?: string;
  placeholder?: string;
  value?: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  variant?: SoftVariant | 'default';
}) {
  const [open, setOpen] = useState(false);
  const theme = variant === 'default' ? null : SOFT_THEMES[variant];
  const selected = options.find((o) => o.value === value);

  return (
    <View style={styles.selectWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? 'Select'}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [
          styles.select,
          theme && { backgroundColor: theme.bg, borderColor: theme.accent },
          open && styles.selectOpen,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.selectValue, !selected && styles.selectPlaceholder]}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={Colors.textMuted}
        />
      </Pressable>

      {open ? (
        <View style={styles.selectOptions}>
          {options.length === 0 ? (
            <Text style={styles.selectEmpty}>No options available.</Text>
          ) : (
            options.map((opt) => {
              const active = opt.value === value;
              return (
                <Pressable
                  key={String(opt.value)}
                  onPress={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.selectOption,
                    active &&
                      (theme
                        ? { backgroundColor: theme.bg }
                        : styles.selectOptionActive),
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={styles.selectOptionContent}>
                    <Text
                      style={[
                        styles.selectOptionText,
                        active &&
                          (theme
                            ? { color: theme.accent, fontWeight: '800' }
                            : styles.selectOptionTextActive),
                      ]}
                    >
                      {opt.label}
                    </Text>
                    {opt.sublabel ? (
                      <Text style={styles.selectOptionSublabel}>
                        {opt.sublabel}
                      </Text>
                    ) : null}
                  </View>
                  {active ? (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={theme ? theme.accent : Colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}
    </View>
  );
}

export function Section({
  title,
  children,
  color,
}: {
  title: string;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, color && { color }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  screen: { flex: 1, padding: Spacing.lg, gap: Spacing.lg },
  scrollContent: { paddingBottom: Spacing.xxl },
  button: {
    height: 52,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: Font.md, fontWeight: '700' },
  field: { gap: Spacing.xs },
  label: { fontSize: Font.sm, fontWeight: '600', color: Colors.text },
  inputWrap: { position: 'relative' },
  inputWithAccessory: { paddingRight: 44 },
  inputAccessory: {
    position: 'absolute',
    right: Spacing.md,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    fontSize: Font.md,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  errorText: { color: Colors.danger, fontSize: Font.xs },
  selectWrap: { gap: Spacing.xs },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    gap: Spacing.sm,
  },
  selectOpen: { borderColor: Colors.primary },
  selectValue: { color: Colors.text, fontSize: Font.md, flex: 1 },
  selectPlaceholder: { color: Colors.textMuted },
  selectOptions: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  selectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  selectOptionActive: { backgroundColor: Colors.primarySoft },
  selectOptionContent: { flex: 1, gap: 2 },
  selectOptionText: {
    color: Colors.text,
    fontSize: Font.md,
    fontWeight: '600',
  },
  selectOptionTextActive: { color: Colors.primaryDark, fontWeight: '800' },
  selectOptionSublabel: { color: Colors.textMuted, fontSize: Font.xs },
  selectEmpty: {
    color: Colors.textMuted,
    fontSize: Font.sm,
    padding: Spacing.md,
  },
  cardTitle: {
    fontSize: Font.md,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  section: { gap: Spacing.md },
  sectionTitle: { fontSize: Font.lg, fontWeight: '700', color: Colors.text },
});

export function OptionChips<T extends string | number>({
  options,
  value,
  onChange,
  renderLabel,
  variant = 'primary',
}: {
  options: T[];
  value?: T;
  onChange: (v: T) => void;
  renderLabel: (v: T) => string;
  variant?: SoftVariant;
}) {
  const theme = SOFT_THEMES[variant];
  return (
    <View style={style2.chipRow}>
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <Pressable
            key={String(opt)}
            onPress={() => onChange(opt)}
            style={[
              style2.chip,
              selected && {
                backgroundColor: theme.bg,
                borderColor: theme.accent,
              },
            ]}
          >
            <Text
              style={[
                style2.chipText,
                selected && { color: theme.accent, fontWeight: '800' },
              ]}
            >
              {renderLabel(opt)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    success: {
      color: Colors.success,
      bg: Colors.successSoft,
      label: 'Successful',
    },
    failed: { color: Colors.danger, bg: Colors.dangerSoft, label: 'Failed' },
    pending: {
      color: Colors.warning,
      bg: Colors.warningSoft,
      label: 'Pending',
    },
    credited: {
      color: Colors.success,
      bg: Colors.successSoft,
      label: 'Credited',
    },
    debit: { color: Colors.danger, bg: Colors.dangerSoft, label: 'Debit' },
    credit: { color: Colors.success, bg: Colors.successSoft, label: 'Credit' },
  };
  const s = map[status] ?? {
    color: Colors.textMuted,
    bg: Colors.border,
    label: status,
  };
  return (
    <View style={[style2.badge, { backgroundColor: s.bg }]}>
      <Text style={[style2.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

export function Empty({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={style2.empty}>
      <Text style={style2.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={style2.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

const style2 = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipSelected: {
    backgroundColor: Colors.primarySoft,
    borderColor: Colors.primary,
  },
  chipText: { color: Colors.textMuted, fontWeight: '600' },
  chipTextSelected: { color: Colors.primaryDark },
  badge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: Font.xs,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  empty: { alignItems: 'center', padding: Spacing.xxl, gap: Spacing.sm },
  emptyTitle: { fontSize: Font.md, fontWeight: '700', color: Colors.text },
  emptySub: { fontSize: Font.sm, color: Colors.textMuted, textAlign: 'center' },
});
