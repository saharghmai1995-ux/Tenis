// ─── Poster engine: latinize sanitizer ──────────────────────────────────────
// Every string drawn on a poster passes through latinize() first.
// Posters are 100% English/Latin: Persian/Arabic glyphs are transliterated,
// typographic symbols are replaced, remaining non-ASCII is dropped.

/** number of mapping rules (telemetry / report) */
export const LATINIZE_MAP_SIZE = 37 + 9 + 9 + 21; // letters + persian digits + arabic digits + symbols

const CHAR_MAP: Record<string, string> = {
  // Persian / Arabic letters → Latin
  'ا': 'a',
  'آ': 'a',
  'أ': 'a',
  'إ': 'a',
  'ب': 'b',
  'پ': 'p',
  'ت': 't',
  'ث': 's',
  'ج': 'j',
  'چ': 'ch',
  'ح': 'h',
  'خ': 'kh',
  'د': 'd',
  'ذ': 'z',
  'ر': 'r',
  'ز': 'z',
  'ژ': 'zh',
  'س': 's',
  'ش': 'sh',
  'ص': 's',
  'ض': 'z',
  'ط': 't',
  'ظ': 'z',
  'ع': 'a',
  'غ': 'gh',
  'ف': 'f',
  'ق': 'gh',
  'ک': 'k',
  'گ': 'g',
  'ل': 'l',
  'م': 'm',
  'ن': 'n',
  'و': 'v',
  'ه': 'h',
  'ی': 'i',
  'ي': 'i',
  'ك': 'k',
  'ة': 'h',
  'ء': 'a',
  // Persian digits → 0-9
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  // Arabic-Indic digits → 0-9
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  // Typographic symbols
  '×': 'x',
  '÷': '/',
  '·': '-',
  '—': '-',
  '–': '-',
  '\u200C': ' ', // ZWNJ → space
  '«': '"',
  '»': '"',
  '\u201C': '"', // left double quote
  '\u201D': '"', // right double quote
  '\u2018': '"', // left single quote
  '\u2019': '"', // right single quote / apostrophe variant
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '±': '+/-',
  '→': '>',
  '←': '<',
  '٪': '%',
};

const isCombiningMark = (cp: number): boolean =>
  (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
  (cp >= 0x1ab0 && cp <= 0x1aff) ||
  (cp >= 0x1dc0 && cp <= 0x1dff) ||
  (cp >= 0x20d0 && cp <= 0x20f0) ||
  (cp >= 0xfe20 && cp <= 0xfe2f);

/** latinize + count how many characters were transformed/removed */
export function latinizeCount(s: string): { text: string; changes: number } {
  if (!s) return { text: '', changes: 0 };
  let out = '';
  let changes = 0;

  for (const ch of s) {
    const mapped = CHAR_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      changes++;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    if (cp < 128) {
      out += ch; // already clean ASCII
      continue;
    }
    // Non-ASCII: try NFD decomposition to keep base Latin letter, drop marks
    const de = ch.normalize('NFD');
    let kept = '';
    for (const d of de) {
      const dcp = d.codePointAt(0)!;
      if (dcp < 128) {
        kept += d;
      } else {
        if (isCombiningMark(dcp)) changes++; // stripped diacritic
        else changes++; // dropped non-ASCII remainder
      }
    }
    if (kept === '' && de.length === 1) changes++; // fully dropped char
    out += kept;
  }

  // collapse multiple spaces into one
  const text = out.replace(/ {2,}/g, ' ');
  return { text, changes };
}

/** convenience: just the clean text */
export function latinize(s: string): string {
  return latinizeCount(s).text;
}
