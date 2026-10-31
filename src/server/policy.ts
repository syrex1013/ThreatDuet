/**
 * Hard limits that hold even with the user's approval, plus a sensitive-data check.
 * shortcut: regex screening, not a classifier; swap for a model-based check if false negatives matter.
 */
const OFF_LIMITS: [RegExp, string][] = [
  [
    /\b(buy|sell|short|trade|trading|purchase)\b[^.\n]{0,40}\b(stocks?|shares?|securities|equit(y|ies)|options|etfs?|bonds?|crypto(currency)?|bitcoin|btc|eth)\b/i,
    'trading securities is off-limits',
  ],
  [
    /\b(transfer|move|wire|send)\b[^.\n]{0,40}\b(money|funds|cash|balance)\b[^.\n]{0,40}\b(between|to|from)\b[^.\n]{0,30}\baccounts?\b/i,
    'moving money between accounts is off-limits',
  ],
];

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Returns why the text may not be acted on, or null when it is allowed. */
export function guard(text: string): string | null {
  for (const [re, why] of OFF_LIMITS) if (re.test(text)) return why;
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return 'contains what looks like a payment card number';
  }
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) return 'contains what looks like a government ID number (SSN)';
  if (/\b(passport|driver'?s? licen[cs]e)\s*(no\.?|number|#)?\s*[:#]?\s*[A-Z0-9]{6,12}\b/i.test(text))
    return 'contains what looks like a government ID number';
  return null;
}

export function hhmm(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

export function inQuiet(time: string, start: string, end: string): boolean {
  return start <= end ? time >= start && time < end : time >= start || time < end;
}
