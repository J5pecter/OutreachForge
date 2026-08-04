import type { ReactNode } from 'react';

export function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
}) {
  const styles = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-300',
    ghost: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-rose-300',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${styles} disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  SENT: 'bg-emerald-100 text-emerald-700',
  OPENED: 'bg-sky-100 text-sky-700',
  PENDING: 'bg-slate-100 text-slate-600',
  QUEUED: 'bg-amber-100 text-amber-700',
  SENDING: 'bg-amber-100 text-amber-700',
  DRAFT: 'bg-slate-100 text-slate-600',
  COMPLETED: 'bg-indigo-100 text-indigo-700',
  FAILED: 'bg-rose-100 text-rose-700',
  BOUNCED: 'bg-rose-100 text-rose-700',
  UNSUBSCRIBED: 'bg-rose-100 text-rose-700',
  SUPPRESSED: 'bg-rose-100 text-rose-700',
  SKIPPED_SUPPRESSED: 'bg-rose-50 text-rose-600',
};

export function Badge({ value }: { value: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[value] ?? 'bg-slate-100 text-slate-600'}`}>
      {value}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
