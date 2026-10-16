import { z } from 'zod';

/** A route's distinct drawn paths, from shapes.txt through trips.shape_id. */
export const routeShapeSchema = z.object({
  route_id: z.string().trim().min(1),
  lines: z.array(z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2)).min(1),
}).strict();
export type RouteShape = z.infer<typeof routeShapeSchema>;

/** About 5 m: enough to keep a tram line on its street at city zoom, small enough to ship per alert. */
const SIMPLIFY_DEGREES = 0.00005;
/** Service variants of one route mostly overlap; the longest few already draw its whole extent. */
export const MAX_SHAPES_PER_ROUTE = 12;

type Point = [number, number];

const round = (value: number) => Math.round(value * 1e5) / 1e5;

function perpendicular(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

/** Iterative Douglas-Peucker, so a long train shape cannot overflow the stack. */
export function simplifyLine(points: readonly Point[], tolerance = SIMPLIFY_DEGREES): Point[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let index = -1;
    let distance = tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const d = perpendicular(points[i]!, points[first]!, points[last]!);
      if (d > distance) { index = i; distance = d; }
    }
    if (index >= 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Collects shape points while a CSV streams, without holding the whole table as row objects. */
export class ShapeCollector {
  private readonly points = new Map<string, [number, number, number][]>();

  add(shapeId: string, sequence: number, lat: number, lon: number): void {
    if (!shapeId || !Number.isFinite(sequence) || !Number.isFinite(lat) || !Number.isFinite(lon)
      || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error('Invalid GTFS shape point');
    }
    let list = this.points.get(shapeId);
    if (!list) { list = []; this.points.set(shapeId, list); }
    list.push([sequence, lon, lat]);
  }

  addRow(row: Readonly<Record<string, string | undefined>>): void {
    this.add(row.shape_id ?? '', Number(row.shape_pt_sequence), Number(row.shape_pt_lat), Number(row.shape_pt_lon));
  }

  /** Each route's distinct simplified paths, longest first, then the routes in id order. */
  routeShapes(trips: readonly { route_id: string; shape_id?: string | null | undefined }[]): RouteShape[] {
    const lines = new Map<string, Point[]>();
    for (const [shapeId, raw] of this.points) {
      raw.sort((a, b) => a[0] - b[0]);
      const path: Point[] = [];
      for (const [, lon, lat] of raw) {
        const point: Point = [round(lon), round(lat)];
        const previous = path.at(-1);
        if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) path.push(point);
      }
      const simplified = simplifyLine(path);
      if (simplified.length >= 2) lines.set(shapeId, simplified);
    }
    const byRoute = new Map<string, Map<string, Point[]>>();
    for (const trip of trips) {
      const line = trip.shape_id ? lines.get(trip.shape_id) : undefined;
      if (!line) continue;
      let distinct = byRoute.get(trip.route_id);
      if (!distinct) { distinct = new Map(); byRoute.set(trip.route_id, distinct); }
      distinct.set(JSON.stringify(line), line);
    }
    return [...byRoute.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([routeId, distinct]) => ({
      route_id: routeId,
      lines: [...distinct.entries()]
        .sort(([keyA, a], [keyB, b]) => b.length - a.length || keyA.localeCompare(keyB))
        .slice(0, MAX_SHAPES_PER_ROUTE).map(([, line]) => line),
    }));
  }
}
