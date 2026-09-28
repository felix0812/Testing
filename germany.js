// Vereinfachter Umriss Deutschlands [lng, lat] und Raster für den Deutschland-Scan.
'use strict';

const GERMANY_OUTLINE = [
  [8.65, 54.91], [9.9, 54.8], [10.9, 54.4], [11.1, 54.0], [12.0, 54.2], [13.0, 54.5], [13.7, 54.6],
  [14.2, 53.9], [14.4, 53.3], [14.1, 52.8], [14.6, 52.6], [14.75, 52.1], [14.6, 51.6], [15.0, 51.1],
  [14.6, 50.85], [13.9, 50.75], [13.0, 50.45], [12.3, 50.2], [12.5, 49.9], [12.9, 49.4], [13.8, 48.8],
  [13.45, 48.55], [13.0, 48.25], [12.95, 47.5], [12.7, 47.68], [12.2, 47.6], [11.1, 47.4], [10.45, 47.55],
  [9.95, 47.55], [9.55, 47.53], [8.6, 47.65], [7.6, 47.58], [7.55, 48.0], [8.2, 48.97], [6.73, 49.16],
  [6.36, 49.46], [6.5, 49.8], [6.1, 50.13], [6.4, 50.32], [6.0, 50.75], [5.87, 51.05], [6.2, 51.4],
  [5.95, 51.8], [6.8, 51.97], [7.05, 52.63], [7.2, 53.25], [7.0, 53.6], [8.0, 53.7], [8.6, 53.9],
  [8.9, 54.1], [8.6, 54.5], [8.4, 55.05]
];

function pointInGermany(lat, lng) {
  let inside = false;
  const p = GERMANY_OUTLINE;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Hexagonales Raster aus Kreisen (Radius radiusKm), das Deutschland lückenlos abdeckt.
function germanyGrid(radiusKm = 25) {
  const r = radiusKm * 0.96;               // leichte Überlappung
  const dy = 1.5 * r, dx = Math.sqrt(3) * r;
  const kmLat = 111.2;
  const pts = [];
  let row = 0;
  for (let lat = 47.2; lat <= 55.2; lat += dy / kmLat, row++) {
    const kmLng = 111.32 * Math.cos(lat * Math.PI / 180);
    const offset = (row % 2) * dx / 2 / kmLng;
    for (let lng = 5.7 + offset; lng <= 15.2; lng += dx / kmLng) {
      // Mittelpunkt oder ein Randpunkt des Kreises liegt in Deutschland
      let hit = pointInGermany(lat, lng);
      for (let a = 0; a < 12 && !hit; a++) {
        const ang = a * Math.PI / 6;
        hit = pointInGermany(lat + Math.sin(ang) * radiusKm / kmLat, lng + Math.cos(ang) * radiusKm / kmLng);
      }
      if (hit) pts.push({ lat: +lat.toFixed(4), lng: +lng.toFixed(4) });
    }
  }
  return pts;
}
