import { mapProjection, stateLabels, type SnapshotView } from '@/lib/rideahead/view';

export default function NavigationMap({
  snapshot,
  onSelect,
}: {
  snapshot: SnapshotView;
  onSelect: (id: string) => void;
}) {
  const points = [
    ...snapshot.routes.flatMap((route) => route.points),
    ...snapshot.riders.flatMap((rider) => (rider.point ? [rider.point] : [])),
    ...snapshot.hazards.flatMap((hazard) => (hazard.point ? [hazard.point] : [])),
  ];
  const project = mapProjection(points);
  return (
    <div className="ra-navigation-map">
      <svg
        viewBox="0 0 400 580"
        preserveAspectRatio="xMidYMid slice"
        role="group"
        aria-label="Navigation route overview with riders and hazard reports"
      >
        <defs>
          <pattern
            id="nav-grid"
            width="52"
            height="52"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(30)"
          >
            <rect width="46" height="46" rx="7" fill="#e0e9dc" />
            <path d="M52 0H0V52" fill="none" stroke="#fafbf5" strokeWidth="7" />
          </pattern>
        </defs>
        <rect width="400" height="580" fill="#edf1e8" />
        <rect width="400" height="580" fill="url(#nav-grid)" opacity=".7" />
        {project && (
          <g transform="translate(200 310) rotate(-60) scale(.51) translate(-350 -210)">
            {snapshot.routes.map((route) => (
              <g key={route.id}>
                <polyline
                  points={route.points.map((point) => project(point).join(',')).join(' ')}
                  fill="none"
                  stroke="white"
                  strokeWidth="22"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points={route.points.map((point) => project(point).join(',')).join(' ')}
                  fill="none"
                  stroke={snapshot.decision?.selectedRouteId === route.id ? '#16785e' : '#aab6a6'}
                  strokeWidth="12"
                  strokeDasharray={
                    snapshot.decision?.selectedRouteId === route.id ? undefined : '16 12'
                  }
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ))}
            {snapshot.riders.map((rider) => {
              if (!rider.point) return null;
              const [x, y] = project(rider.point);
              return (
                <g key={rider.id} transform={`translate(${x} ${y}) rotate(60)`}>
                  <circle
                    r="30"
                    fill={rider.id === 'bike_b' ? '#197b60' : '#324b43'}
                    stroke="white"
                    strokeWidth="6"
                  />
                  <text textAnchor="middle" y="7" fill="white" fontSize="22" fontWeight="700">
                    {rider.id.replace('bike_', '').toUpperCase()}
                  </text>
                  <title>{rider.name}</title>
                </g>
              );
            })}
            {snapshot.hazards.map((hazard) => {
              if (!hazard.point) return null;
              const [x, y] = project(hazard.point);
              return (
                <g
                  key={hazard.id}
                  transform={`translate(${x} ${y - 45}) rotate(60)`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${hazard.title}: ${stateLabels[hazard.state]}`}
                  onClick={() => onSelect(hazard.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelect(hazard.id);
                    }
                  }}
                >
                  <circle
                    r="30"
                    fill={
                      hazard.state === 'cleared'
                        ? '#b9dbad'
                        : hazard.state === 'stale'
                          ? '#d7d0bc'
                          : '#f2c875'
                    }
                    stroke="white"
                    strokeWidth="6"
                  />
                  <text textAnchor="middle" y="10" fontSize="30" fill="#3d412d" fontWeight="700">
                    {hazard.state === 'cleared' ? '✓' : '!'}
                  </text>
                  <title>{hazard.title}</title>
                </g>
              );
            })}
          </g>
        )}
      </svg>
      {!project && <p className="ra-no-location">Waiting for route location</p>}
      <span className="ra-compass" aria-label="North points towards the upper left">
        ↖<small>N</small>
      </span>
      <span className="ra-map-disclaimer">Route overview · illustrative background</span>
    </div>
  );
}
