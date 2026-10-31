export function formatNaira(amount: number): string {
  const val = Number.isFinite(amount) ? amount : 0;
  return `₦${val.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

export const NG_PHONE = /^(\+?234|0)[789][01]\d{8}$/;

export function isValidNigerianPhone(phone: string): boolean {
  return NG_PHONE.test(phone.trim());
}

/**
 * Normalise a phone number read from a device contact into a Nigerian
 * 0-prefixed mobile number.
 * - Keeps only digits and a leading '+'.
 * - '+234 801 234 5678', '(234)8012345678', '234 801…' → '08012345678'.
 * - '08012345678' is left unchanged.
 */
export function normalizeContactPhone(raw: string): string {
  let s = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+234')) s = `0${s.slice(4)}`;
  else if (s.startsWith('234') && s.length > 10) s = `0${s.slice(3)}`;
  return s;
}

export function formatDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function truncate(str: string, len = 40): string {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}
