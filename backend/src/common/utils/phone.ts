/**
 * Normalise a Nigerian phone number to the bare international format that
 * ebulksms requires on the wire: country code `234` + 10-digit number, with
 * no leading `0` or `+`.
 *
 * Accepts: `08012345678`, `+2348012345678`, `2348012345678`.
 * Returns `null` when the number is not a valid Nigerian mobile number.
 */
export function toInternationalFormat(phone: string): string | null {
  const raw = String(phone ?? '').replace(/[\s-]/g, '');
  const match = raw.match(/^(\+?234|0)([789][01]\d{8})$/);
  if (!match) return null;
  return `234${match[2]}`;
}