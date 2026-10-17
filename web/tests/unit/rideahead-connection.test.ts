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
  it('selects the recorded Broadway scenario even when it is absent from the ride list', async () => {
    mock.POST.mockResolvedValue(response(raw()));
    mock.GET.mockResolvedValue(response(raw()));
    await createRideAheadConnection(
      'nyc_streets_cam-1:walker-st',
      'nyc-broadway-work-zone-v1',
    ).read();
    expect(mock.POST.mock.calls[0][1].body).toEqual({
      ride_id: 'nyc_streets_cam-1:walker-st',
      scenario_id: 'nyc-broadway-work-zone-v1',
    });
  });
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
  it('applies radius sliders with PATCH /api/rideahead/sessions/{id}/config', async () => {
    const created = raw();
    created.session_id = 'session-under-test';
    mock.POST.mockResolvedValue(response(created));
    mock.PATCH.mockResolvedValue(response(created));
    await createRideAheadConnection().configure({ shortRadiusM: 150, planningRadiusM: 3000 });
    expect(mock.PATCH).toHaveBeenCalledTimes(1);
    const [path, options] = mock.PATCH.mock.calls[0];
    expect(path).toBe('/api/rideahead/sessions/{session_id}/config');
    expect(options.params).toEqual({ path: { session_id: 'session-under-test' } });
    expect(options.body).toEqual({ share_radius_m: 150, planning_radius_m: 3000 });
  });
  it('rejects a failed config update with a readable error, never fixture success', async () => {
    mock.POST.mockResolvedValue(response(raw()));
    mock.PATCH.mockResolvedValue({ response: new Response(null, { status: 422 }) });
    await expect(
      createRideAheadConnection().configure({ shortRadiusM: 150, planningRadiusM: 3000 }),
    ).rejects.toThrow('RideAhead server returned 422');
  });
  it('reports denied access instead of substituting fixture success', async () => {
    mock.POST.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    await expect(createRideAheadConnection().read()).rejects.toThrow('valid demo key');
  });
});

describe('canonical snapshot presentation', () => {
  it('labels the Cosmos strip from actual model provenance', () => {
    const source = structuredClone(canonical.t160) as unknown as Schemas['SessionSnapshot'];
    const verified = source.observations.filter((item) => item.verification).at(-1)!;
    expect(toSnapshotView(source).cosmos.source).toBe('cached_model');
    verified.verification!.source = 'fixture';
    expect(toSnapshotView(source).cosmos.source).toBe('fixture');
    verified.verification!.source = 'live_model';
    expect(toSnapshotView(source).cosmos.source).toBe('live_model');
  });
  it('never shows future inference text in the bottom strip', () => {
    const source = structuredClone(canonical.t160) as unknown as Schemas['SessionSnapshot'];
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
    const source = structuredClone(canonical.t160) as unknown as Schemas['SessionSnapshot'];
    const view = toSnapshotView(source);
    const [lon, lat] = source.routes[0].geometry.coordinates[0];
    expect(view.routes[0].points[0]).toEqual({ lat, lon });
    const synthetic = view.evidence.find((item) => item.provenance.includes('Synthetic'));
    expect(synthetic?.mediaPath).toBeNull();
    const recorded = view.evidence.find((item) => item.provenance.includes('Cached recorded'));
    expect(recorded?.mediaPath).toMatch(/^\/api\/archive\/media\?source=/);
  });
  it('defensively excludes future evidence even if supplied in a snapshot', () => {
    const source = structuredClone(canonical.t450) as unknown as Schemas['SessionSnapshot'];
    source.replay_time_s = 0;
    expect(toSnapshotView(source).evidence).toEqual([]);
  });
});
