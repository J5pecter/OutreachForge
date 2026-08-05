// Thin typed fetch wrapper around the OutreachForge API.
import { demoApi } from './demo';

// Demo mode (VITE_DEMO=true) swaps the real fetch client for an in-memory one,
// so the UI is fully browsable when hosted without a backend (e.g. Netlify).
export const IS_DEMO = import.meta.env.VITE_DEMO === 'true';

// Optional external backend origin; empty = same-origin (dev proxy / nginx).
const BASE = `${import.meta.env.VITE_API_BASE ?? ''}/api`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.error ?? `Request failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return data as T;
}

export type ConsentBasis =
  | 'OPT_IN'
  | 'EXISTING_CUSTOMER'
  | 'CONTRACT'
  | 'LEGITIMATE_INTEREST'
  | 'IMPORTED_WITH_CONSENT';

export type Lead = {
  id: string;
  email: string;
  firstName: string | null;
  company: string | null;
  title: string | null;
  status: string;
  consentBasis: ConsentBasis;
  consentSource: string;
  createdAt: string;
};

export type IngestResult = {
  received: number;
  created: number;
  updated: number;
  skippedSuppressed: number;
  errors: { index: number; email?: string; message: string }[];
};

export type Campaign = {
  id: string;
  name: string;
  status: string;
  subjectTemplate: string;
  throttlePerHour: number;
};

export type CampaignStats = {
  campaign: Campaign;
  byStatus: Record<string, number>;
};

const realApi = {
  listLeads: (status?: string) =>
    request<{ leads: Lead[]; nextCursor: string | null }>(
      `/leads${status ? `?status=${status}` : ''}`,
    ),

  ingestCsv: (csv: string, defaults: { consentBasis: ConsentBasis; consentSource: string }) =>
    request<IngestResult>(
      `/leads/ingest/csv?consentBasis=${defaults.consentBasis}&consentSource=${encodeURIComponent(
        defaults.consentSource,
      )}`,
      { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv },
    ),

  createCampaign: (body: {
    name: string;
    subjectTemplate: string;
    bodyTemplate: string;
    aiEnabled?: boolean;
    aiPrompt?: string;
    throttlePerHour?: number;
  }) => request<Campaign>('/campaigns', { method: 'POST', body: JSON.stringify(body) }),

  campaignStats: (id: string) => request<CampaignStats>(`/campaigns/${id}`),

  buildAudience: (id: string) =>
    request<{ matched: number; enrolled: number; skippedSuppressed: number }>(
      `/campaigns/${id}/audience`,
      { method: 'POST', body: '{}' },
    ),

  renderCampaign: (id: string) =>
    request<{ rendered: number; personalized?: number; errors: { email: string; message: string }[] }>(
      `/campaigns/${id}/render`,
      { method: 'POST' },
    ),

  queueCampaign: (id: string) =>
    request<{ status: string; readyToSend: number }>(`/campaigns/${id}/queue`, { method: 'POST' }),

  dispatch: (id: string, max = 500) =>
    request<{ enqueued: number; perHour: number; intervalMs: number; note?: string }>(
      `/campaigns/${id}/dispatch`,
      { method: 'POST', body: JSON.stringify({ max }) },
    ),

  listSuppression: () =>
    request<{ id: string; email: string; reason: string; createdAt: string }[]>('/suppression'),

  suppress: (email: string, reason = 'MANUAL') =>
    request<{ email: string }>('/suppression', {
      method: 'POST',
      body: JSON.stringify({ email, reason }),
    }),
};

// The cast makes demoApi conform to the real client's exact signatures — any
// drift between the two becomes a compile error here rather than a runtime gap.
export const api: typeof realApi = IS_DEMO ? (demoApi as typeof realApi) : realApi;
