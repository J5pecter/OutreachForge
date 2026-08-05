import { useState } from 'react';
import { IS_DEMO } from './api';
import { LeadsPanel } from './panels/LeadsPanel';
import { CampaignsPanel } from './panels/CampaignsPanel';
import { SuppressionPanel } from './panels/SuppressionPanel';

const TABS = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'leads', label: 'Leads' },
  { key: 'suppression', label: 'Suppression' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function App() {
  const [tab, setTab] = useState<TabKey>('campaigns');

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {IS_DEMO && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          <strong>Demo mode.</strong> Sample data, no live backend — nothing is sent. Explore the
          full flow: import leads, compose a campaign, build audience, render, queue, and dispatch.
        </div>
      )}
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
            OF
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">OutreachForge</h1>
            <p className="text-xs text-slate-500">Consent-based outreach · suppression enforced</p>
          </div>
        </div>
      </header>

      <nav className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-2 font-medium transition ${
              tab === t.key ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'campaigns' && <CampaignsPanel />}
      {tab === 'leads' && <LeadsPanel />}
      {tab === 'suppression' && <SuppressionPanel />}
    </div>
  );
}
