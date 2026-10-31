// Geometry a travel server needs: great-circle distance and the nearest
// point on a route line, so "near" filters and "start from here" work.

/** Great-circle distance in miles between { lat, lon } points. */
export function miles(a, b) {
  const r = Math.PI / 180;
  const x =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) *
      Math.cos(b.lat * r) *
      Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 7917.6 * Math.asin(Math.sqrt(x));
}

const MI_PER_DEG_LAT = 69.0;

/**
 * Nearest point on a polyline of [mile, lat, lon, ...] points. A point whose
 * 5th element is 1 starts a new segment after a gap and is never projected
 * across. Returns { mile, offMiles }.
 */
export function nearestOnLine(points, geo) {
  const kx = MI_PER_DEG_LAT * Math.cos((geo.lat * Math.PI) / 180);
  let best = { mile: null, offMiles: Infinity };
  for (let i = 1; i < points.length; i++) {
    if (points[i][4] === 1) continue;
    const [m1, lat1, lon1] = points[i - 1];
    const [m2, lat2, lon2] = points[i];
    const ax = (lon1 - geo.lon) * kx;
    const ay = (lat1 - geo.lat) * MI_PER_DEG_LAT;
    const bx = (lon2 - geo.lon) * kx;
    const by = (lat2 - geo.lat) * MI_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    if (off < best.offMiles) best = { mile: m1 + t * (m2 - m1), offMiles: off };
  }
  return {
    mile: best.mile == null ? null : Math.round(best.mile * 10) / 10,
    offMiles: Math.round(best.offMiles * 10) / 10,
  };
}
