"""Small pure geometry helpers (metres, degrees). Lines are GeoJSON [lon, lat] coordinate lists.

Local equirectangular approximation per segment: accurate to well under a metre over the
few-kilometre demo area, which is far below our location uncertainty.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.agent.models import LatLon, Polygon

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(a: LatLon, b: LatLon) -> float:
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lon - a.lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def bearing_deg(a: LatLon, b: LatLon) -> float:
    """Initial bearing from a to b, degrees clockwise from north in [0, 360)."""
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dl = math.radians(b.lon - a.lon)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def angle_diff_deg(a: float, b: float) -> float:
    """Smallest absolute difference between two bearings, in [0, 180]."""
    d = abs(a - b) % 360
    return 360 - d if d > 180 else d


def to_latlon(coord: list[float]) -> LatLon:
    return LatLon(lat=coord[1], lon=coord[0])


def line_length_m(coords: list[list[float]]) -> float:
    return sum(
        haversine_m(to_latlon(coords[i]), to_latlon(coords[i + 1])) for i in range(len(coords) - 1)
    )


@dataclass(frozen=True)
class Projection:
    along_m: float  # distance from the start of the line to the closest point
    offset_m: float  # distance from the point to the line
    bearing_deg: float  # bearing of the line at the closest point
    point: LatLon


def _xy(origin: LatLon, p: LatLon) -> tuple[float, float]:
    k = math.cos(math.radians(origin.lat))
    return (
        math.radians(p.lon - origin.lon) * k * EARTH_RADIUS_M,
        math.radians(p.lat - origin.lat) * EARTH_RADIUS_M,
    )


def project(point: LatLon, coords: list[list[float]]) -> Projection:
    """Closest point on the line to `point`."""
    if len(coords) < 2:
        p = to_latlon(coords[0])
        return Projection(0.0, haversine_m(point, p), 0.0, p)
    best: Projection | None = None
    walked = 0.0
    for i in range(len(coords) - 1):
        a, b = to_latlon(coords[i]), to_latlon(coords[i + 1])
        seg = haversine_m(a, b)
        bx, by = _xy(a, b)
        px, py = _xy(a, point)
        denom = bx * bx + by * by
        t = 0.0 if denom == 0 else max(0.0, min(1.0, (px * bx + py * by) / denom))
        cx, cy = bx * t, by * t
        offset = math.hypot(px - cx, py - cy)
        if best is None or offset < best.offset_m:
            closest = LatLon(lat=a.lat + (b.lat - a.lat) * t, lon=a.lon + (b.lon - a.lon) * t)
            best = Projection(walked + seg * t, offset, bearing_deg(a, b), closest)
        walked += seg
    assert best is not None
    return best


def point_along(coords: list[list[float]], distance_m: float) -> tuple[LatLon, float]:
    """Point and bearing at `distance_m` along the line (clamped to its ends)."""
    if len(coords) < 2:
        return to_latlon(coords[0]), 0.0
    remaining = max(0.0, distance_m)
    for i in range(len(coords) - 1):
        a, b = to_latlon(coords[i]), to_latlon(coords[i + 1])
        seg = haversine_m(a, b)
        if remaining <= seg or i == len(coords) - 2:
            t = 1.0 if seg == 0 else min(1.0, remaining / seg)
            p = LatLon(lat=a.lat + (b.lat - a.lat) * t, lon=a.lon + (b.lon - a.lon) * t)
            return p, bearing_deg(a, b)
        remaining -= seg
    raise AssertionError("unreachable")


def circle_polygon(center: LatLon, radius_m: float, sides: int = 12) -> Polygon:
    """Closed polygon approximating a circle (for provider avoid-areas)."""
    ring: list[list[float]] = []
    dlat = math.degrees(radius_m / EARTH_RADIUS_M)
    dlon = dlat / max(1e-9, math.cos(math.radians(center.lat)))
    for i in range(sides):
        a = 2 * math.pi * i / sides
        ring.append(
            [round(center.lon + dlon * math.cos(a), 7), round(center.lat + dlat * math.sin(a), 7)]
        )
    ring.append(ring[0])
    return Polygon(coordinates=[ring])
