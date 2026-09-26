// Where a name belongs inside a shape: the point farthest from its edges (the pole of
// inaccessibility), not the centroid. A bay's centroid can sit on land and a crescent sea's outside it;
// the point deepest inside is where a cartographer writes the name.
//
// The search splits the shape's box into square cells and keeps splitting the cells that could still
// hold a deeper point, best first, until no cell can beat the best point by more than the precision.
// Longitudes are shrunk by the cosine of the shape's latitude first, so "far from the edges" means
// far on the ground and not only in degrees.

export type Ring = number[][];

type Cell = { x: number; y: number; half: number; distance: number; best: number };

/** Signed distance from a point to the polygon's edges: positive inside, negative outside. */
function signedDistance(x: number, y: number, rings: Ring[]): number {
  let inside = false;
  let nearest = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      nearest = Math.min(nearest, segmentDistanceSquared(x, y, ax, ay, bx, by));
    }
  }
  const distance = Math.sqrt(nearest);
  return inside ? distance : -distance;
}

function segmentDistanceSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  let x = ax;
  let y = ay;
  let dx = bx - x;
  let dy = by - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = bx;
      y = by;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

const cell = (x: number, y: number, half: number, rings: Ring[]): Cell => {
  const distance = signedDistance(x, y, rings);
  return { x, y, half, distance, best: distance + half * Math.SQRT2 };
};

/** The ring's area-weighted centre, a good first guess for convex shapes. */
function centroidCell(rings: Ring[]): Cell {
  const ring = rings[0];
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[j];
    const f = ax * by - bx * ay;
    x += (ax + bx) * f;
    y += (ay + by) * f;
    area += f * 3;
  }
  if (area === 0) return cell(ring[0][0], ring[0][1], 0, rings);
  return cell(x / area, y / area, 0, rings);
}

/**
 * The point deepest inside a polygon (outer ring first, then its holes), in the planar coordinates
 * given, and how deep it lies. `precision` is in the same units.
 */
export function poleOfInaccessibility(rings: Ring[], precision: number): { x: number; y: number; distance: number } {
  const outer = rings[0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const size = Math.min(width, height);
  if (!(size > 0)) return { x: minX, y: minY, distance: 0 };

  // Best first: a plain array kept sorted by what each cell could still hold is plenty for the few
  // thousand cells a coastline needs.
  const queue: Cell[] = [];
  const push = (c: Cell) => {
    let lo = 0;
    let hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (queue[mid].best < c.best) lo = mid + 1;
      else hi = mid;
    }
    queue.splice(lo, 0, c);
  };
  const half = size / 2;
  for (let x = minX; x < maxX; x += size) {
    for (let y = minY; y < maxY; y += size) push(cell(x + half, y + half, half, rings));
  }
  let best = centroidCell(rings);
  const middle = cell(minX + width / 2, minY + height / 2, 0, rings);
  if (middle.distance > best.distance) best = middle;

  let guard = 0;
  while (queue.length && guard++ < 200000) {
    const next = queue.pop()!;
    if (next.distance > best.distance) best = next;
    if (next.best - best.distance <= precision) continue;
    const h = next.half / 2;
    push(cell(next.x - h, next.y - h, h, rings));
    push(cell(next.x + h, next.y - h, h, rings));
    push(cell(next.x - h, next.y + h, h, rings));
    push(cell(next.x + h, next.y + h, h, rings));
  }
  return { x: best.x, y: best.y, distance: best.distance };
}

/**
 * Where to write the name of a geographic polygon or multipolygon: the deepest point of its largest
 * part, measured on the ground. Returns [lng, lat].
 */
export function labelPoint(geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] }): [number, number] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let chosen = polygons[0];
  let largest = -1;
  for (const polygon of polygons) {
    const area = Math.abs(ringArea(polygon[0]));
    if (area > largest) {
      largest = area;
      chosen = polygon;
    }
  }
  let south = Infinity;
  let north = -Infinity;
  for (const [, lat] of chosen[0]) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const k = Math.max(0.05, Math.cos((((south + north) / 2) * Math.PI) / 180));
  const planar = chosen.map((ring) => ring.map(([lng, lat]) => [lng * k, lat]));
  const pole = poleOfInaccessibility(planar, Math.max(1e-4, (north - south) / 200));
  return [pole.x / k, pole.y];
}

function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return sum / 2;
}
