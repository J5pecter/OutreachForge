// Minimal, safe merge-field renderer.
//
// This intentionally does ONLY straightforward token substitution —
// {{firstName}}, {{company}}, {{attributes.industry}}. There is deliberately no
// "spin syntax", randomised invisible markup, or per-message mutation designed
// to defeat spam classifiers. Legitimate personalisation means saying something
// true and specific to the recipient, not disguising identical bulk mail.

import { HttpError } from './http';

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lookup(path: string, ctx: Record<string, unknown>): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, ctx);
}

/** Return the set of tokens referenced by a template. */
export function extractTokens(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(TOKEN)) found.add(m[1]);
  return [...found];
}

/**
 * Render a template. By default a missing token throws, so a campaign can be
 * validated before send rather than silently emailing "Hi {{firstName}}".
 */
export function render(
  template: string,
  ctx: Record<string, unknown>,
  opts: { html?: boolean; strict?: boolean; optional?: string[] } = {},
): string {
  const { html = true, strict = true, optional = [] } = opts;
  const optionalSet = new Set(optional);
  return template.replace(TOKEN, (_match, path: string) => {
    const value = lookup(path, ctx);
    if (value === undefined || value === null || value === '') {
      // Tokens listed as optional (e.g. {{ai}} in template-only mode) may be
      // empty without failing an otherwise-strict render.
      if (strict && !optionalSet.has(path)) {
        throw new HttpError(422, `Template references empty merge field "${path}"`);
      }
      return '';
    }
    const str = String(value);
    return html ? escapeHtml(str) : str;
  });
}
