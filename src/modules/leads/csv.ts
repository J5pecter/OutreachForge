import { parse } from 'csv-parse/sync';

/**
 * Parse a CSV upload into raw lead rows. Recognised headers (case-insensitive):
 *   email, firstName, lastName, company, title,
 *   consentBasis, consentSource, consentAt, consentNote
 * Any other columns are folded into `attributes` and become merge fields.
 */
export function parseLeadsCsv(csv: string): Record<string, unknown>[] {
  const records: Record<string, string>[] = parse(csv, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  const known = new Set([
    'email',
    'firstname',
    'lastname',
    'company',
    'title',
    'consentbasis',
    'consentsource',
    'consentat',
    'consentnote',
  ]);

  return records.map((row) => {
    const out: Record<string, unknown> = {};
    const attributes: Record<string, string> = {};
    for (const [rawKey, value] of Object.entries(row)) {
      const key = rawKey.toLowerCase();
      if (value === '') continue;
      switch (key) {
        case 'email':
          out.email = value;
          break;
        case 'firstname':
          out.firstName = value;
          break;
        case 'lastname':
          out.lastName = value;
          break;
        case 'company':
          out.company = value;
          break;
        case 'title':
          out.title = value;
          break;
        case 'consentbasis':
          out.consentBasis = value;
          break;
        case 'consentsource':
          out.consentSource = value;
          break;
        case 'consentat':
          out.consentAt = value;
          break;
        case 'consentnote':
          out.consentNote = value;
          break;
        default:
          if (!known.has(key)) attributes[rawKey] = value;
      }
    }
    out.attributes = attributes;
    return out;
  });
}
