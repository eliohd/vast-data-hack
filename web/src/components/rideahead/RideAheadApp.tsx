import { useEffect, useState } from 'react';
import { api, type Schemas } from '@/lib/api/client';
import { createRideAheadConnection } from '@/lib/rideahead/connection';
import RideAhead from './RideAhead';

export default function RideAheadApp() {
  const [connection, setConnection] = useState(() => createRideAheadConnection());
  const [offline, setOffline] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [rides, setRides] = useState<Schemas['RideManifest'][]>([]);
  const [scenarios, setScenarios] = useState<Schemas['ScenarioSummary'][]>([]);
  const [rideId, setRideId] = useState('');
  const [ridesError, setRidesError] = useState(false);
  const [scenariosError, setScenariosError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api
      .GET('/api/rideahead/rides', {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      })
      .then(({ data }) => {
        if (data) setRides(data);
        else setRidesError(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRidesError(true);
      });
    void api
      .GET('/api/rideahead/capabilities', {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      })
      .then(({ data }) => {
        if (data) setScenarios(data.scenarios ?? []);
        else setScenariosError(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setScenariosError(true);
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="ra-presentation">
      <details className="ra-demo-controls">
        <summary>Demo controls</summary>
        <div className="ra-mode-bar">
          <label htmlFor="ra-ride">Ride or scenario</label>
          <select id="ra-ride" value={rideId} onChange={(event) => setRideId(event.target.value)}>
            <option value="">Server default ride</option>
            {scenarios.length > 0 && (
              <optgroup label="Demo scenarios">
                {scenarios.map((scenario) => (
                  <option key={scenario.scenario_id} value={`scenario:${scenario.scenario_id}`}>
                    {scenario.title}
                  </option>
                ))}
              </optgroup>
            )}
            {rides.map((ride) => (
              <option key={ride.ride_id} value={ride.ride_id}>
                {ride.title} · {ride.provenance}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const scenario = scenarios.find((item) => `scenario:${item.scenario_id}` === rideId);
              setConnection(
                createRideAheadConnection(
                  scenario ? scenario.ride_id : rideId || undefined,
                  scenario?.scenario_id,
                ),
              );
              setOffline(false);
              setGeneration((value) => value + 1);
            }}
          >
            Connect session
          </button>
          <button
            aria-pressed={offline}
            onClick={() => {
              setOffline(true);
              setGeneration((value) => value + 1);
            }}
          >
            Use offline fixture
          </button>
          {ridesError && <span>Ride list unavailable</span>}
          {scenariosError && <span>Scenario list unavailable</span>}
        </div>
      </details>
      <RideAhead key={generation} connection={offline ? undefined : connection} />
    </div>
  );
}
