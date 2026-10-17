// Live navigation helpers (pure, unit-tested): OSM geocoding (Nominatim) and bike routing
// (OSRM on routing.openstreetmap.de) parsing, route progress and hazard rerouting.

export type LatLon = { lat: number; lon: number };
export type Place = { name: string; detail: string; lat: number; lon: number };
export type NavStep = { instruction: string; name: string; distanceM: number; location: LatLon };
export type NavRoute = {
  points: [number, number][];
  distanceM: number;
  durationS: number;
  steps: NavStep[];
};

export const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
export const ROUTE_URL = 'https://routing.openstreetmap.de/routed-bike/route/v1/driving';

export function geocodeUrl(query: string, near: LatLon | null): string {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6' });
  if (near) {
    const d = 0.15; // ~15 km box: prefer nearby results without excluding others
    params.set('viewbox', `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`);
  }
  return `${GEOCODE_URL}?${params}`;
}

export function routeUrl(from: LatLon, to: LatLon): string {
  return `${ROUTE_URL}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=true`;
}

export function haversineM(a: LatLon, b: LatLon): number {
  const r = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function parsePlaces(json: unknown): Place[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((item: Record<string, unknown>) => {
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const full = String(item.display_name ?? '');
    const name = String(item.name || full.split(',')[0] || 'Destination');
    const detail = full.split(',').slice(1, 4).join(',').trim();
    return [{ name, detail, lat, lon }];
  });
}

type OsrmStep = {
  name?: string;
  distance?: number;
  maneuver?: { type?: string; modifier?: string; exit?: number; location?: [number, number] };
};

export function stepInstruction(step: OsrmStep): string {
  const type = step.maneuver?.type ?? 'continue';
  const modifier = step.maneuver?.modifier ?? '';
  const onto = step.name ? ` onto ${step.name}` : '';
  if (type === 'depart') return step.name ? `Head off on ${step.name}` : 'Head off';
  if (type === 'arrive') return 'Arrive at your destination';
  if (type === 'roundabout' || type === 'rotary')
    return step.maneuver?.exit
      ? `At the roundabout, take exit ${step.maneuver.exit}${onto}`
      : `Go round the roundabout${onto}`;
  if (modifier === 'uturn') return `Make a U-turn${onto}`;
  if (!modifier || modifier === 'straight') return `Continue${onto}`;
  return `${type === 'fork' ? 'Keep' : 'Turn'} ${modifier}${onto}`;
}

export function parseRoutes(json: unknown): NavRoute[] {
  const routes = (json as { code?: string; routes?: unknown[] })?.routes;
  if ((json as { code?: string })?.code !== 'Ok' || !Array.isArray(routes)) return [];
  return routes.flatMap((raw) => {
    const route = raw as {
      distance?: number;
      duration?: number;
      geometry?: { coordinates?: [number, number][] };
      legs?: { steps?: OsrmStep[] }[];
    };
    const coords = route.geometry?.coordinates ?? [];
    if (coords.length < 2) return [];
    const steps = (route.legs ?? []).flatMap((leg) => leg.steps ?? []);
    return [
      {
        points: coords.map(([lon, lat]) => [lat, lon] as [number, number]),
        distanceM: route.distance ?? 0,
        durationS: route.duration ?? 0,
        steps: steps.flatMap((step) => {
          const loc = step.maneuver?.location;
          if (!loc) return [];
          return [
            {
              instruction: stepInstruction(step),
              name: step.name ?? '',
              distanceM: step.distance ?? 0,
              location: { lat: loc[1], lon: loc[0] },
            },
          ];
        }),
      },
    ];
  });
}

/** Approximate distance from a position to the route line (nearest vertex; OSRM is dense). */
export function distanceToRouteM(points: readonly [number, number][], p: LatLon): number {
  let best = Infinity;
  for (const [lat, lon] of points) best = Math.min(best, haversineM({ lat, lon }, p));
  return best;
}

/** Advance past manoeuvres the rider has reached (within `reachM`). Never goes backwards. */
export function nextStepIndex(
  steps: readonly NavStep[],
  position: LatLon,
  current: number,
  reachM = 20,
): number {
  let index = Math.max(1, current);
  while (index < steps.length - 1 && haversineM(steps[index].location, position) <= reachM)
    index += 1;
  return Math.min(index, Math.max(0, steps.length - 1));
}

/** First route point at least `aheadM` from the rider: where a reported hazard is assumed. */
export function pointAhead(
  points: readonly [number, number][],
  position: LatLon,
  aheadM = 40,
): LatLon {
  let nearest = 0;
  points.forEach(([lat, lon], i) => {
    const [nlat, nlon] = points[nearest];
    if (haversineM({ lat, lon }, position) < haversineM({ lat: nlat, lon: nlon }, position))
      nearest = i;
  });
  for (let i = nearest; i < points.length; i += 1) {
    const [lat, lon] = points[i];
    if (haversineM({ lat, lon }, position) >= aheadM) return { lat, lon };
  }
  const [lat, lon] = points[points.length - 1];
  return { lat, lon };
}

/** The candidate that stays farthest from the hazard, if it clears it by `clearM`. */
export function pickDetour(
  routes: readonly NavRoute[],
  hazard: LatLon,
  clearM = 25,
): NavRoute | null {
  let best: NavRoute | null = null;
  let bestGap = clearM;
  for (const route of routes) {
    const gap = distanceToRouteM(route.points, hazard);
    if (gap > bestGap) {
      best = route;
      bestGap = gap;
    }
  }
  return best;
}
