import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Schemas } from '@/lib/api/client';
import canonical from '@/lib/rideahead/canonical-snapshots.json';

const mock = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: mock }));
import { createRideAheadConnection, toSnapshotView } from '@/lib/rideahead/connection';

const raw = () => structuredClone(canonical.t0) as unknown as Schemas['SessionSnapshot'];
const response = (data: Schemas['SessionSnapshot']) => ({
  data,
  response: new Response(null, { status: 200 }),
});
beforeEach(() => {
  vi.resetAllMocks();
});

describe('frozen API integration', () => {
  it('creates one session for concurrent readers and never advances on a read', async () => {
    mock.POST.mockResolvedValue(response(raw()));
    mock.GET.mockResolvedValue(response(raw()));
    const connection = createRideAheadConnection();
    await Promise.all([connection.read(), connection.read()]);
    expect(mock.POST).toHaveBeenCalledTimes(1);
    expect(mock.POST.mock.calls[0][0]).toBe('/api/rideahead/sessions');
    expect(mock.GET).toHaveBeenCalledTimes(2);
    expect(mock.GET.mock.calls[0][0]).toBe('/api/rideahead/sessions/{session_id}');
  });
  it('sends replay and configuration changes through the frozen contract', async () => {
    mock.POST.mockResolvedValue(response(raw()));
    mock.PATCH.mockResolvedValue(response(raw()));
    const connection = createRideAheadConnection();
    await connection.advance(60);
    await connection.configure({ shortRadiusM: 300, planningRadiusM: 2500 });
    expect(mock.POST.mock.calls[1][1].body).toEqual({ to_s: 60 });
    expect(mock.PATCH.mock.calls[0][1].body).toEqual({
      share_radius_m: 300,
      planning_radius_m: 2500,
    });
  });
  it('reports denied access instead of substituting fixture success', async () => {
    mock.POST.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    await expect(createRideAheadConnection().read()).rejects.toThrow('valid demo key');
  });
});

describe('canonical snapshot presentation', () => {
  it('labels the Cosmos strip from actual model provenance', () => {
    const source = structuredClone(canonical.t60) as unknown as Schemas['SessionSnapshot'];
    expect(toSnapshotView(source).cosmos.source).toBe('fixture');
    source.observations[0].verification!.source = 'cached_model';
    expect(toSnapshotView(source).cosmos.source).toBe('cached_model');
    source.observations[0].verification!.source = 'live_model';
    expect(toSnapshotView(source).cosmos.source).toBe('live_model');
  });
  it('never shows future inference text in the bottom strip', () => {
    const source = structuredClone(canonical.t60) as unknown as Schemas['SessionSnapshot'];
    source.replay_time_s = 0;
    expect(toSnapshotView(source).cosmos.source).toBe('unavailable');
    expect(toSnapshotView(source).cosmos.timeS).toBeNull();
  });
  it('preserves server decisions, missing locations and configured versus connected status', () => {
    const source = raw();
    source.riders[0].position = null;
    source.integrations = [{ name: 'weave', state: 'configured', detail: 'Not verified' }];
    const view = toSnapshotView(source);
    expect(view.riders[0].point).toBeNull();
    expect(view.decision?.action).toBe(source.decisions[0].action);
    expect(view.integrations[0].status).toBe('Configured · not verified');
  });
  it('converts GeoJSON longitude/latitude explicitly and blocks synthetic playback', () => {
    const source = structuredClone(canonical.t60) as unknown as Schemas['SessionSnapshot'];
    const view = toSnapshotView(source);
    const [lon, lat] = source.routes[0].geometry.coordinates[0];
    expect(view.routes[0].points[0]).toEqual({ lat, lon });
    expect(view.evidence[0].mediaPath).toBeNull();
    expect(view.evidence[0].provenance).toContain('Synthetic');
  });
  it('defensively excludes future evidence even if supplied in a snapshot', () => {
    const source = structuredClone(canonical.t450) as unknown as Schemas['SessionSnapshot'];
    source.replay_time_s = 0;
    expect(toSnapshotView(source).evidence).toEqual([]);
  });
});
