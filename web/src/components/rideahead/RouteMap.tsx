import { mapProjection, stateLabels, type SnapshotView } from '@/lib/rideahead/view';

export default function RouteMap({
  snapshot,
  selectedHazard,
  onSelect,
}: {
  snapshot: SnapshotView;
  selectedHazard: string | null;
  onSelect: (id: string) => void;
}) {
  const points = [
    ...snapshot.routes.flatMap((route) => route.points),
    ...snapshot.riders.flatMap((rider) => (rider.point ? [rider.point] : [])),
    ...snapshot.hazards.flatMap((hazard) => (hazard.point ? [hazard.point] : [])),
  ];
  const project = mapProjection(points);
  return (
    <section className="ra-map" aria-label="Route map">
      <div className="ra-map-heading">
        <span className="ra-eyebrow">THE SHARED ROAD</span>
        <span>Route overview · north ↑</span>
      </div>
      {project ? (
        <svg
          viewBox="0 0 700 420"
          role="group"
          aria-label="Route geometry, riders and reported hazards. No street basemap."
        >
          <defs>
            <pattern id="ra-grid" width="35" height="35" patternUnits="userSpaceOnUse">
              <path d="M 35 0 L 0 0 0 35" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="700" height="420" fill="url(#ra-grid)" className="ra-map-grid" />
          {snapshot.routes.map((route, i) => (
            <polyline
              key={route.id}
              points={route.points.map((point) => project(point).join(',')).join(' ')}
              fill="none"
              stroke={i === 0 ? '#8c9694' : '#147d63'}
              strokeWidth={snapshot.decision?.selectedRouteId === route.id ? 9 : 5}
              strokeDasharray={i === 0 ? '9 9' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {snapshot.riders.map((rider) => {
            if (!rider.point) return null;
            const [x, y] = project(rider.point);
            return (
              <g key={rider.id} transform={`translate(${x},${y})`}>
                <circle
                  r="19"
                  fill={rider.id === 'bike_a' ? '#243d39' : '#147d63'}
                  stroke="white"
                  strokeWidth="4"
                />
                <text textAnchor="middle" y="5" fill="white" fontSize="14" fontWeight="700">
                  {rider.id.replace('bike_', '').toUpperCase()}
                </text>
                <title>
                  {rider.name}
                  {rider.simulated ? ' · simulated' : ''}
                </title>
              </g>
            );
          })}
          {snapshot.hazards.map((hazard) => {
            if (!hazard.point) return null;
            const [x, y] = project(hazard.point);
            return (
              <g
                key={hazard.id}
                transform={`translate(${x},${y - 40})`}
                role="button"
                tabIndex={0}
                aria-label={`${hazard.title}: ${stateLabels[hazard.state]}`}
                aria-pressed={selectedHazard === hazard.id}
                onClick={() => onSelect(hazard.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(hazard.id);
                  }
                }}
              >
                <circle
                  r={selectedHazard === hazard.id ? 24 : 20}
                  className={`ra-marker ra-${hazard.state}`}
                />
                <text textAnchor="middle" y="6" fontSize="22" fontWeight="700">
                  {hazard.state === 'cleared' ? '✓' : '!'}
                </text>
                <title>
                  {hazard.title}: {stateLabels[hazard.state]}
                </title>
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="ra-map-empty">Location unknown. Reports remain available below.</div>
      )}
      <div className="ra-map-footer">
        <span>
          <i className="ra-line ra-original" />
          Original route
        </span>
        <span>
          <i className="ra-line" />
          Alternative
        </span>
        <span>No street basemap</span>
      </div>
      <p className="ra-location">{snapshot.locationLabel}</p>
      <div className="ra-hazard-list" aria-label="Select a hazard">
        {snapshot.hazards.map((hazard) => (
          <button
            key={hazard.id}
            className={`ra-hazard-choice ${selectedHazard === hazard.id ? 'is-selected' : ''}`}
            onClick={() => onSelect(hazard.id)}
            aria-pressed={selectedHazard === hazard.id}
          >
            <span className={`ra-state ra-${hazard.state}`}>{stateLabels[hazard.state]}</span>{' '}
            {hazard.title}
            {!hazard.point && ' · location unknown'}
          </button>
        ))}
        {snapshot.hazards.length === 0 && <p>No reports available at this replay time.</p>}
      </div>
    </section>
  );
}
