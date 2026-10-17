import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type Schemas } from '@/lib/api/client';

type Upstream = Schemas['UpstreamStatus'];

/** Which upstreams the server can reach right now. The 9:30 check, in the UI. */
export default function StatusPanel() {
  const [upstreams, setUpstreams] = useState<Upstream[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: apiError } = await api.GET('/api/health/upstreams');
    if (data) setUpstreams(data.upstreams);
    if (apiError) setError('Server unreachable or not authorised.');
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Upstreams</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Probe
        </Button>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(upstreams ?? []).map((u) => (
            <li key={u.name} className="flex items-center justify-between rounded-md border p-3">
              <div className="min-w-0">
                <p className="font-medium">{u.name}</p>
                <p className="truncate text-xs text-muted-foreground" title={u.detail ?? ''}>
                  {u.detail}
                </p>
              </div>
              <Badge variant={u.ok ? 'default' : u.configured ? 'destructive' : 'secondary'}>
                {u.ok ? `${u.latency_ms} ms` : u.configured ? 'down' : 'off'}
              </Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
