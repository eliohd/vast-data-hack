# Cyclist hazard catalogue (lane C, 2026-10-17)

Source: every segment caption in the team-46 VSS archive (612 chunks, 3,537 five-second segments),
read through `VSSClient.explore`. A clause counts only if it **asserts** the hazard. Clauses with
"no / not / without…" are dropped, so "no accidents" is not a hit. **Caption-level only:** none of
these is verified unless marked ✅. Earlier checks showed captions often call a vehicle *beside* a bike
lane "blocking" it (see handoff-C).

Segment id format: `<camera> | <recording> | c<chunk>-s<segment>` (segment = 5 s; chunk = 30 s).

## Counts (segments with an asserted clause)

| Category | Segments | Main cameras |
|---|---|---|
| Accident / emergency vehicles | 34 | bike gopro 16, NYC Walker St cam 7, SF cam-5 4, NYC cam-2 3 |
| Construction / work zone | 668 | NYC Walker St cam 256, Toronto dashcam 165, bike gopro 112, NYC cam-2 112 |
| Lane blocked | 260 | Toronto dashcam 127, bike gopro 91, NYC Walker St cam 18, SF cam-1 12 |
| Heavy traffic | 41 | Toronto dashcam 28, bike gopro 8 |
| Door-opening (dooring risk) | 9 | SF cam-1 4, Toronto 2 |
| Surface / weather | 34 | neighbourhood cam 20 (rain/fog), bike gopro 12 |

**No real crash footage:** all 80 caption mentions of "accident", 33 of "collision" and 42 of
"near-miss" are negated. The emergency category is emergency *vehicles*, not crashes.

## Best examples

### Emergency vehicles (likely incident or road closure ahead)
| Segment | Evidence (caption clause) |
|---|---|
| nyc_streets_cam-1 \| VID_20261006_174811_003 \| c12-s5 | red and white ambulance **with flashing lights** drives through the intersection (Broadway & Walker St, anchorable) |
| nyc_streets_cam-1 \| VID_20261006_171812_002 \| c21-s6 | white police SUV **with flashing lights** follows behind it (same intersection) |
| nyc_streets_cam-1 \| VID_20261006_171812_002 \| c03-s5/s6 | FDNY ambulance parked on the street / moving behind the bus |
| nyc_streets_cam-2 \| IMG_0509 \| c28-s1/s2 | red **fire truck "21"** moving slowly through the intersection |
| sf_streets_cam-1 \| sf1 \| c13-s2 | San Francisco Fire Department ambulance drives through the intersection |
| sf_streets_cam-5 \| sf5 \| c22-s1 | police SUV **with flashing lights** moving through the intersection |
| nyc_bike_gopro-1 \| GX050001 \| c11-s3 | red emergency vehicle, likely an ambulance, parked or moving slowly (bike view) |
| pie_cam-3 \| set06 \| c11-s5 | **CAA flatbed tow truck** beside an SUV (Toronto; possible breakdown) |

### Construction / work zones
| Segment | Evidence |
|---|---|
| ✅ nyc_streets_cam-1 \| VID_20261006_174811_003 \| c04-s6 (+ 171812_002 c17-s2) | red barrier + orange barrels **on the road**, flagger with orange flag; Cosmos supported, frame-reviewed; anchored Broadway & Walker St (cache `walker_work_zone_v1.json`) |
| nyc_bike_gopro-1 \| GX050001 \| c19-s3 | orange and white construction barriers **block off a portion of the lane** (bike view) |
| nyc_bike_gopro-1 \| GX050001 \| c09-s1 | white construction barriers and a works truck on the right side of the road |
| nyc_bike_gopro-1 \| GX050001 \| c05-s3 | traffic cones along the road, construction or lane closure |
| nyc_bike_gopro-1 \| GX050001 \| c17-s2 | traffic cone near the bike lane, partially blocking the path (Cosmos v1 said supported, but frame review showed the green lane clear) |

### Lane blocked by vehicles
| Segment | Evidence |
|---|---|
| nyc_bike_gopro-1 \| GX010001 \| c00-s1 … c02-s4 | **USPS delivery truck(s)** parked in the middle of the street, blocking the lane, cyclist stopped beside it; anchor sign "Amsterdam Billiards & Bar" (E 11th St) |
| nyc_bike_gopro-1 \| GX050001 \| c21-s5 | large black bus partially blocking the lane |
| nyc_bike_gopro-1 \| GX050001 \| c20-s2 | black car parked partially blocking the lane after a turn |
| nyc_bike_gopro-1 \| GX050001 \| c05-s3/s4 | red sedan parked at the curb in the rider's curbside lane (reviewed: uncertain, cannot anchor) |
| nyc_bike_gopro-1 \| GX010001 \| c15-s1/s5/s6 | caption says vehicles block the bike lane; **reviewed: contradicted** (vehicles beside the lane) |

### Dooring risk (open car doors)
| Segment | Evidence |
|---|---|
| sf_streets_cam-1 \| sf1 \| c06-s5 | black SUV stopped, **driver-side door open** |
| sf_streets_cam-1 \| sf1 \| c07-s1 | parked SUV with rear passenger door open |
| sf_streets_cam-2 \| sf2 \| c10-s6 | stationary truck, driver-side door open |
| nyc_streets_cam-1 \| VID_20261006_171812_002 \| c12-s3 | taxi stopped at the intersection with a door open |
| nyc_bike_gopro-1 \| GX010001 \| c14-s3 | silver van with its side door open, person exiting (6th Ave at W 36 St) |

### Heavy traffic
| Segment | Evidence |
|---|---|
| nyc_bike_gopro-1 \| GOPR0130 \| c14-s2 | cyclist riding through heavy traffic |
| nyc_bike_gopro-1 \| GX010001 \| c11-s4 | busy multi-lane street with heavy traffic (6th Ave ~W 29 St) |
| nyc_bike_gopro-1 \| GOPR0130 \| c25-s1 | busy city street with heavy traffic |

### Surface / weather
| Segment | Evidence |
|---|---|
| nyc_bike_gopro-1 \| GX010001 \| c03-s4 | road surface is wet, recent rain |
| nyc_bike_gopro-1 \| GX010001 \| c02-s2 | worn road with scattered debris |
| neighborhood_cam-1 (20 segments) | rain, fog, droplets on the lens, wet night street |

## How to reproduce

The scan uses `app.agent.perception_claims.split_clauses` plus category regexes, with clause-level
negation dropped. Raw results (897 segments) were produced in a scratch run; ask lane C to re-run or
commit them if needed.
