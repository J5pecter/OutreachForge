import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Badge, Button, Card, Field, inputClass } from '../ui';

export function SuppressionPanel() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');

  const list = useQuery({ queryKey: ['suppression'], queryFn: () => api.listSuppression() });
  const add = useMutation({
    mutationFn: () => api.suppress(email),
    onSuccess: () => {
      setEmail('');
      qc.invalidateQueries({ queryKey: ['suppression'] });
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Do-not-contact list">
        <div className="space-y-4">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Addresses here are never imported or emailed again. Unsubscribes, hard bounces, and spam
            complaints land here automatically; add a manual entry for direct opt-out requests.
          </p>
          <Field label="Suppress an address">
            <div className="flex gap-2">
              <input
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@example.com"
              />
              <Button variant="danger" onClick={() => add.mutate()} disabled={add.isPending || !email.includes('@')}>
                Suppress
              </Button>
            </div>
          </Field>
          {add.isError && <p className="text-xs text-rose-600">{(add.error as Error).message}</p>}
        </div>
      </Card>

      <Card
        title={`Suppressed${list.data ? ` (${list.data.length})` : ''}`}
        actions={
          <Button variant="ghost" onClick={() => list.refetch()}>
            Refresh
          </Button>
        }
      >
        {list.isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : list.data && list.data.length > 0 ? (
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100">
              {list.data.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 font-medium text-slate-700">{s.email}</td>
                  <td className="text-right">
                    <Badge value={s.reason} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400">Nothing suppressed yet.</p>
        )}
      </Card>
    </div>
  );
}
