import { useEffect, useState } from 'react';
import { api, type Schemas } from '@/lib/api/client';
import { createRideAheadConnection } from '@/lib/rideahead/connection';
import { clipsFromSegments, rideStartOffset } from '@/lib/rideahead/feed';
import RideAhead from './RideAhead';

export default function RideAheadApp() {
  const [connection, setConnection] = useState(() => createRideAheadConnection());
  const [offline, setOffline] = useState(
    () => new URLSearchParams(window.location.search).get('preview') === '1',
  );
  const [generation, setGeneration] = useState(0);
  const [rides, setRides] = useState<Schemas['RideManifest'][]>([]);
  const [rideId, setRideId] = useState('');
  const [ridesError, setRidesError] = useState(false);
  const [scenariosError, setScenariosError] = useState(false);
  const [scenarios, setScenarios] = useState<Schemas['ScenarioSummary'][]>([]);
  const [scenarioId, setScenarioId] = useState('');
  // What the current connection was opened with ('' = server default = first scenario listed).
  const [connected, setConnected] = useState({ scenarioId: '', rideId: '' });
  const connectedScenario = connected.rideId
    ? undefined
    : (scenarios.find((item) => item.scenario_id === connected.scenarioId) ?? scenarios[0]);
  const feedRideId = connected.rideId || connectedScenario?.ride_id;
  const feedRide = rides.find((ride) => ride.ride_id === feedRideId);
  const rideFeed = offline
    ? undefined
    : {
        clips: clipsFromSegments(feedRide?.segments ?? []),
        startOffsetS: rideStartOffset(connectedScenario?.labels ?? []),
      };
  useEffect(() => {
    const controller = new AbortController();
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
    let retry: number | undefined;
    const loadRides = (attempt: number) =>
      void api
        .GET('/api/rideahead/rides', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        })
        .then(({ data }) => {
          if (data) return setRides(data);
          if (attempt < 5) retry = window.setTimeout(() => loadRides(attempt + 1), 3000);
          else setRidesError(true);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          if (attempt < 5) retry = window.setTimeout(() => loadRides(attempt + 1), 3000);
          else setRidesError(true);
        });
    loadRides(0);
    return () => {
      controller.abort();
      window.clearTimeout(retry);
    };
  }, []);
  return (
    <div className="ra-presentation">
      <RideAhead
        key={generation}
        connection={offline ? undefined : connection}
        rideFeed={rideFeed}
        sessionControls={
          <>
            <h2>Session source</h2>
            <div className="ra-mode-bar">
              <label htmlFor="ra-ride">Ride</label>
              <select
                id="ra-ride"
                value={rideId}
                onChange={(event) => {
                  setRideId(event.target.value);
                  setScenarioId('');
                }}
              >
                <option value="">Server default ride</option>
                {rides.map((ride) => (
                  <option key={ride.ride_id} value={ride.ride_id}>
                    {ride.title} · {ride.provenance}
                  </option>
                ))}
              </select>
              <label htmlFor="ra-scenario">Scenario</label>
              <select
                id="ra-scenario"
                value={scenarioId}
                onChange={(event) => {
                  setScenarioId(event.target.value);
                  setRideId('');
                }}
              >
                <option value="">Server default scenario</option>
                {scenarios.map((scenario) => (
                  <option key={scenario.scenario_id} value={scenario.scenario_id}>
                    {scenario.title}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  setConnection(
                    createRideAheadConnection(
                      scenarios.find((item) => item.scenario_id === scenarioId)?.ride_id ??
                        (rideId || undefined),
                      scenarioId || undefined,
                    ),
                  );
                  setConnected({ scenarioId, rideId });
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
          </>
        }
      />
    </div>
  );
}
