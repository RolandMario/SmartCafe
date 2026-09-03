import { randomBytes } from 'crypto';

export function generateReference(prefix: string): string {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const rand = randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${date}-${rand}`;
}

/**
 * VTPass-compliant request id. VTPass rejects UUIDs/hyphenated ids:
 * the FIRST 12 CHARACTERS MUST be today's date + current hour & minute
 * (YYYYMMDDHHMM) evaluated in Africa/Lagos time (GMT+1), followed by any
 * random alphanumeric suffix (≥ 12 chars total). See
 * https://vtpass.com/documentation/how-to-generate-request-id/
 */
export function generateRequestId(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const part: Record<string, string> = {};
  for (const p of parts) part[p.type] = p.value;
  if (part.hour === '24') part.hour = '00'; // hour12:false can report midnight as '24'
  const timestamp = `${part.year}${part.month}${part.day}${part.hour}${part.minute}`;
  const suffix = randomBytes(8).toString('hex').toUpperCase();
  return `${timestamp}${suffix}`;
}

export function isNumericId(value: string): boolean {
  return /^[a-f\d]{24}$/i.test(value);
}