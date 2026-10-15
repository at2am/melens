/** West, south, east, north, as the map contract's bbox. */
type Bbox = readonly [number, number, number, number];

type Position = readonly [number, number];
type Ring = readonly Position[];

/**
 * A parsed GeoJSON geometry with its bounding box, prepared once per cached row so each viewport
 * test is a box check plus, only for lines and polygons that straddle the viewport edge, an exact
 * planar test.
 */
export interface PreparedGeometry {
  readonly bbox: Bbox;
  readonly points: readonly Position[];
  readonly lines: readonly Ring[];
  readonly polygons: readonly (readonly Ring[])[];
}

function position(value: unknown): Position {
  if (!Array.isArray(value) || value.length < 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number'
    || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) throw new TypeError('Invalid GeoJSON position');
  return [value[0], value[1]];
}
const positions = (value: unknown): Position[] => {
  if (!Array.isArray(value)) throw new TypeError('Invalid GeoJSON coordinates');
  return value.map(position);
};
const rings = (value: unknown): Ring[] => {
  if (!Array.isArray(value)) throw new TypeError('Invalid GeoJSON coordinates');
  return value.map(positions);
};

/** Parse the GeoJSON text the views return; anything malformed is rejected, never guessed. */
export function prepareGeometry(geojson: string): PreparedGeometry {
  const points: Position[] = [];
  const lines: Ring[] = [];
  const polygons: Ring[][] = [];
  const visit = (geometry: unknown): void => {
    if (typeof geometry !== 'object' || geometry === null) throw new TypeError('Invalid GeoJSON geometry');
    const { type, coordinates, geometries } = geometry as { type?: unknown; coordinates?: unknown; geometries?: unknown };
    switch (type) {
      case 'Point': points.push(position(coordinates)); return;
      case 'MultiPoint': points.push(...positions(coordinates)); return;
      case 'LineString': lines.push(positions(coordinates)); return;
      case 'MultiLineString': lines.push(...rings(coordinates)); return;
      case 'Polygon': polygons.push(rings(coordinates)); return;
      case 'MultiPolygon':
        if (!Array.isArray(coordinates)) throw new TypeError('Invalid GeoJSON coordinates');
        for (const polygon of coordinates) polygons.push(rings(polygon));
        return;
      case 'GeometryCollection':
        if (!Array.isArray(geometries)) throw new TypeError('Invalid GeoJSON collection');
        for (const part of geometries) visit(part);
        return;
      default: throw new TypeError('Unsupported GeoJSON geometry');
    }
  };
  visit(JSON.parse(geojson));
  const all = [...points, ...lines.flat(), ...polygons.flat(2)];
  if (all.length === 0) throw new TypeError('Empty GeoJSON geometry');
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  return { bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], points, lines, polygons };
}

const inBox = ([x, y]: Position, [west, south, east, north]: Bbox) => x >= west && x <= east && y >= south && y <= north;

function orientation(a: Position, b: Position, c: Position): number {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  return value === 0 ? 0 : value > 0 ? 1 : 2;
}
const onSegment = (a: Position, b: Position, c: Position) =>
  b[0] <= Math.max(a[0], c[0]) && b[0] >= Math.min(a[0], c[0]) && b[1] <= Math.max(a[1], c[1]) && b[1] >= Math.min(a[1], c[1]);
function segmentsIntersect(p1: Position, q1: Position, p2: Position, q2: Position): boolean {
  const o1 = orientation(p1, q1, p2), o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1), o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(p1, p2, q1)) || (o2 === 0 && onSegment(p1, q2, q1))
    || (o3 === 0 && onSegment(p2, p1, q2)) || (o4 === 0 && onSegment(p2, q1, q2));
}
function segmentTouchesBox(a: Position, b: Position, box: Bbox): boolean {
  if (inBox(a, box) || inBox(b, box)) return true;
  const [west, south, east, north] = box;
  const corners: Position[] = [[west, south], [east, south], [east, north], [west, north]];
  return corners.some((corner, index) => segmentsIntersect(a, b, corner, corners[(index + 1) % 4]!));
}
function pathTouchesBox(path: Ring, box: Bbox): boolean {
  if (path.length === 1) return inBox(path[0]!, box);
  for (let index = 1; index < path.length; index += 1) if (segmentTouchesBox(path[index - 1]!, path[index]!, box)) return true;
  return false;
}
/** Even-odd ray casting; a polygon's holes flip the result. */
function inPolygon([x, y]: Position, polygon: readonly Ring[]): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!; const [xj, yj] = ring[j]!;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * The planar counterpart of BigQuery's ST_INTERSECTSBOX. Points and boxes give the same answer;
 * BigQuery follows geodesic edges, so a long line or polygon edge passing within metres of the
 * viewport corner can differ. Map features here span at most a few kilometres.
 */
export function intersectsBox(geometry: PreparedGeometry, box: Bbox): boolean {
  const [west, south, east, north] = box;
  const [minX, minY, maxX, maxY] = geometry.bbox;
  if (maxX < west || minX > east || maxY < south || minY > north) return false;
  if (geometry.points.some((point) => inBox(point, box))) return true;
  if (geometry.lines.some((line) => pathTouchesBox(line, box))) return true;
  return geometry.polygons.some((polygon) => polygon.some((ring) => pathTouchesBox(ring, box))
    || inPolygon([west, south], polygon));
}
