import { lifecycleOrder, lifecycleStyles } from '@/lib/rideahead/lifecycle';
import { HazardGlyph } from './LifecycleIcon';

/** Compact legend for every lifecycle state, drawn with the same glyphs as the map markers. */
export default function MapLegend({ unmapped }: { unmapped: number }) {
  return (
    <div className="ra-map-legend" role="group" aria-label="Hazard state legend">
      <ul>
        {lifecycleOrder.map((state) => (
          <li key={state} data-legend-state={state} title={lifecycleStyles[state].description}>
            <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
              <HazardGlyph state={state} radius={6} />
            </svg>
            {lifecycleStyles[state].label}
          </li>
        ))}
      </ul>
      {unmapped > 0 && (
        <p>
          {unmapped} report{unmapped === 1 ? '' : 's'} · location unknown
        </p>
      )}
    </div>
  );
}
