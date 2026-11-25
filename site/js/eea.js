// EEA reference grid helpers.
//
// A cell code such as "1kmE2639N1762" encodes the lower-left corner of the cell
// in EPSG:3035 (ETRS89 / LAEA Europe): x = 2639 * 1000 m, y = 1762 * 1000 m.
// The data files therefore only need (e, n, values...) per cell; the squares are
// rebuilt here and reprojected to WGS84 for the web map.

/* global proj4 */

const EPSG_3035 =
  "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 " +
  "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

export function resolutionLabel(resolution) {
  return resolution >= 1000 ? `${resolution / 1000}km` : `${resolution}m`;
}

export function cellCode(resolution, e, n) {
  return `${resolutionLabel(resolution)}E${e}N${n}`;
}

/**
 * Convert a grid data file ({resolution, fields, rows}) to a GeoJSON
 * FeatureCollection in WGS84. Corners shared by neighbouring cells are only
 * reprojected once.
 */
export function gridToGeoJSON(grid) {
  const toWgs84 = proj4(EPSG_3035, "EPSG:4326");
  const res = grid.resolution;
  const fields = grid.fields;
  const cache = new Map();

  const corner = (e, n) => {
    const key = e * 1e7 + n;
    let c = cache.get(key);
    if (!c) {
      const [lon, lat] = toWgs84.forward([e * res, n * res]);
      c = [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
      cache.set(key, c);
    }
    return c;
  };

  const features = grid.rows.map((row, i) => {
    const e = row[0];
    const n = row[1];
    const properties = { code: cellCode(res, e, n) };
    for (let j = 2; j < fields.length; j++) properties[fields[j]] = row[j];
    return {
      type: "Feature",
      id: i,
      properties,
      geometry: {
        type: "Polygon",
        coordinates: [[corner(e, n), corner(e + 1, n), corner(e + 1, n + 1), corner(e, n + 1), corner(e, n)]],
      },
    };
  });

  return { type: "FeatureCollection", features };
}

/**
 * Bounding box [[west, south], [east, north]] of a GeoJSON grid, ignoring the
 * outer `trim` fraction of cells on each side (e.g. scattered offshore records).
 */
export function bounds(geojson, trim = 0.05) {
  const xs = [];
  const ys = [];
  for (const f of geojson.features) {
    const [x, y] = f.geometry.coordinates[0][0];
    xs.push(x);
    ys.push(y);
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
  return [[q(xs, trim), q(ys, trim)], [q(xs, 1 - trim), q(ys, 1 - trim)]];
}
