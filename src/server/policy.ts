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

const CREDENTIALS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\b(password|passwd|api[_ -]?key|secret|token)\s*[:=]\s*\S{6,}/i,
];

/** IBAN length per country: the SWIFT registry, plus countries whose banks use IBANs unofficially. */
const IBAN_LEN: Record<string, number> = Object.fromEntries(
  ('AD24 AE23 AL28 AT20 AZ28 BA20 BE16 BG22 BH22 BI27 BR29 BY28 CH21 CR22 CY28 CZ24 DE22 DJ27 DK18 DO28 EE20 EG29 ES24 FI18 FK18 FO18 FR27 GB22 GE22 GI23 GL18 GR27 GT28 HN28 HR21 HU28 IE22 IL23 IQ23 IS26 IT27 JO30 KW30 KZ20 LB28 LC32 LI21 LT20 LU20 LV21 LY25 MC27 MD24 ME22 MK19 MN20 MR27 MT31 MU30 NI28 NL18 NO15 OM23 PK24 PL28 PS29 PT25 QA29 RO24 RS22 RU33 SA24 SC31 SD18 SE24 SI19 SK24 SM27 SO23 ST25 SV28 TL23 TN24 TR26 UA29 VA22 VG24 XK20 YE30 ' +
    'AO25 BF28 BJ28 CF27 CG27 CI28 CM27 CV25 DZ26 GA27 GQ27 GW25 IR26 KM27 MA28 MG27 ML28 MZ25 NE28 SN28 TD27 TG28')
    .split(' ')
    .map((x) => [x.slice(0, 2), Number(x.slice(2))]),
);

function iban(s: string): boolean {
  const n = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const d of n) r = (r * 10 + Number(d)) % 97;
  return r === 1;
}

const CONSENT: [RegExp, string][] = [
  [/\b(diagnosed with|prescriptions?|medications?|therapy|medical records?|pregnan\w*|HIV)\b/i, 'health'],
  [/\b(salary|salaries|bank balance|account number|routing number|tax returns?|credit score|debts?|net worth)\b/i, 'finances'],
];

/** Labels for sensitive topics the user should knowingly share: allowed, but flagged on the approval card. */
export function consent(text: string): string[] {
  return CONSENT.filter(([re]) => re.test(text)).map(([, label]) => label);
}

/** Returns why the text may not be acted on, or null when it is allowed. */
export function guard(text: string): string | null {
  for (const [re, why] of OFF_LIMITS) if (re.test(text)) return why;
  if (CREDENTIALS.some((re) => re.test(text))) return 'contains what looks like a password or access key';
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g)) {
    // The greedy match can swallow a following code ("… BIC GKCCBEBB"), so check the country's IBAN length only.
    const s = m[0].replace(/ /g, '');
    const len = IBAN_LEN[s.slice(0, 2)];
    if (len && s.length >= len && iban(s.slice(0, len))) return 'contains what looks like a bank account number (IBAN)';
  }
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
