// In-memory demo backend. When the app is built with VITE_DEMO=true (e.g. the
// Netlify static deploy, which has no live API), the api client uses this
// instead of fetch — so the whole dashboard is fully interactive with sample
// data. Nothing here sends email or talks to a network.
import type { Campaign, CampaignStats, ConsentBasis, IngestResult, Lead } from './api';

let seq = 0;
const genId = (p: string) => `${p}_${(++seq).toString(36)}${Date.now().toString(36).slice(-4)}`;
const iso = () => new Date().toISOString();
const wait = <T>(value: T, ms = 260): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

const leads: Lead[] = [
  { id: genId('lead'), email: 'dana@northwind.example', firstName: 'Dana', company: 'Northwind', title: 'Head of Ops', status: 'ACTIVE', consentBasis: 'OPT_IN', consentSource: 'Website demo request — Jul 2026', createdAt: iso() },
  { id: genId('lead'), email: 'sam@acme.example', firstName: 'Sam', company: 'Acme', title: 'CTO', status: 'ACTIVE', consentBasis: 'EXISTING_CUSTOMER', consentSource: 'Active subscription since 2025', createdAt: iso() },
  { id: genId('lead'), email: 'priya@lumina.example', firstName: 'Priya', company: 'Lumina Labs', title: 'VP Marketing', status: 'ACTIVE', consentBasis: 'OPT_IN', consentSource: 'Webinar signup — Aug 2026', createdAt: iso() },
  { id: genId('lead'), email: 'marco@vela.example', firstName: 'Marco', company: 'Vela Freight', title: 'Founder', status: 'ACTIVE', consentBasis: 'LEGITIMATE_INTEREST', consentSource: 'Documented LI assessment #2026-114', createdAt: iso() },
  { id: genId('lead'), email: 'aisha@fernback.example', firstName: 'Aisha', company: 'Fernback', title: 'Head of Growth', status: 'ACTIVE', consentBasis: 'IMPORTED_WITH_CONSENT', consentSource: 'Partner list (consent on file)', createdAt: iso() },
];

const suppression: { id: string; email: string; reason: string; createdAt: string }[] = [
  { id: genId('sup'), email: 'optout@acme.example', reason: 'UNSUBSCRIBE', createdAt: iso() },
];

type DemoCampaign = Campaign & { aiEnabled: boolean; recipients: { leadId: string; status: string }[] };
const campaigns = new Map<string, DemoCampaign>();

const isSuppressed = (email: string) =>
  suppression.some((s) => s.email.toLowerCase() === email.toLowerCase());

const asCampaign = (c: DemoCampaign): Campaign => ({
  id: c.id,
  name: c.name,
  status: c.status,
  subjectTemplate: c.subjectTemplate,
  throttlePerHour: c.throttlePerHour,
});

export const demoApi = {
  listLeads: (status?: string) =>
    wait({
      leads: leads.filter((l) => (status ? l.status === status : true)).slice().reverse(),
      nextCursor: null as string | null,
    }),

  ingestCsv: (csv: string, defaults: { consentBasis: ConsentBasis; consentSource: string }) => {
    const rows = csv.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    const result: IngestResult = { received: 0, created: 0, updated: 0, skippedSuppressed: 0, errors: [] };
    if (rows.length < 2) return wait(result);
    const header = rows[0].split(',').map((h) => h.trim().toLowerCase());
    const ei = header.indexOf('email');
    const fi = header.indexOf('firstname');
    const ci = header.indexOf('company');
    const ti = header.indexOf('title');
    rows.slice(1).forEach((line, idx) => {
      result.received += 1;
      const cells = line.split(',').map((c) => c.trim());
      const email = ei >= 0 ? cells[ei] : cells[0];
      if (!email || !email.includes('@')) {
        result.errors.push({ index: idx, email, message: 'email: invalid or missing' });
        return;
      }
      if (isSuppressed(email)) {
        result.skippedSuppressed += 1;
        return;
      }
      if (leads.some((l) => l.email.toLowerCase() === email.toLowerCase())) {
        result.updated += 1;
        return;
      }
      leads.push({
        id: genId('lead'),
        email,
        firstName: fi >= 0 ? cells[fi] || null : null,
        company: ci >= 0 ? cells[ci] || null : null,
        title: ti >= 0 ? cells[ti] || null : null,
        status: 'ACTIVE',
        consentBasis: defaults.consentBasis,
        consentSource: defaults.consentSource,
        createdAt: iso(),
      });
      result.created += 1;
    });
    return wait(result);
  },

  createCampaign: (body: {
    name: string;
    subjectTemplate: string;
    bodyTemplate: string;
    aiEnabled?: boolean;
    aiPrompt?: string;
    throttlePerHour?: number;
  }) => {
    const c: DemoCampaign = {
      id: genId('camp'),
      name: body.name,
      status: 'DRAFT',
      subjectTemplate: body.subjectTemplate,
      throttlePerHour: body.throttlePerHour ?? 200,
      aiEnabled: !!body.aiEnabled,
      recipients: [],
    };
    campaigns.set(c.id, c);
    return wait<Campaign>(asCampaign(c));
  },

  campaignStats: (id: string) => {
    const c = campaigns.get(id);
    const byStatus: Record<string, number> = {};
    if (c) for (const r of c.recipients) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const campaign: Campaign = c
      ? asCampaign(c)
      : { id, name: '(unknown)', status: 'DRAFT', subjectTemplate: '', throttlePerHour: 200 };
    return wait<CampaignStats>({ campaign, byStatus });
  },

  buildAudience: (id: string) => {
    const c = campaigns.get(id);
    const active = leads.filter((l) => l.status === 'ACTIVE');
    let enrolled = 0;
    let skippedSuppressed = 0;
    if (c) {
      c.recipients = [];
      for (const l of active) {
        if (isSuppressed(l.email)) {
          skippedSuppressed += 1;
          continue;
        }
        c.recipients.push({ leadId: l.id, status: 'PENDING' });
        enrolled += 1;
      }
    }
    return wait({ matched: active.length, enrolled, skippedSuppressed });
  },

  renderCampaign: (id: string) => {
    const c = campaigns.get(id);
    const rendered = c ? c.recipients.filter((r) => r.status === 'PENDING').length : 0;
    const personalized = c && c.aiEnabled ? rendered : 0;
    return wait({ rendered, personalized, errors: [] as { email: string; message: string }[] });
  },

  queueCampaign: (id: string) => {
    const c = campaigns.get(id);
    if (c) c.status = 'QUEUED';
    const readyToSend = c ? c.recipients.filter((r) => r.status === 'PENDING').length : 0;
    return wait({ status: c?.status ?? 'QUEUED', readyToSend });
  },

  dispatch: (id: string, max = 500) => {
    const c = campaigns.get(id);
    let enqueued = 0;
    if (c) {
      const pending = c.recipients.filter((r) => r.status === 'PENDING').slice(0, max);
      // Simulate delivery: most SENT, ~40% marked OPENED so analytics look alive.
      pending.forEach((r, i) => {
        r.status = i % 5 < 2 ? 'OPENED' : 'SENT';
        enqueued += 1;
      });
      c.status = c.recipients.some((r) => r.status === 'PENDING') ? 'SENDING' : 'COMPLETED';
    }
    return wait({ enqueued, perHour: c?.throttlePerHour ?? 200, intervalMs: 0 });
  },

  listSuppression: () => wait(suppression.slice().reverse()),

  suppress: (email: string, _reason = 'MANUAL') => {
    if (!isSuppressed(email)) {
      suppression.push({ id: genId('sup'), email, reason: 'MANUAL', createdAt: iso() });
    }
    const lead = leads.find((l) => l.email.toLowerCase() === email.toLowerCase());
    if (lead) lead.status = 'SUPPRESSED';
    return wait({ email });
  },
};
