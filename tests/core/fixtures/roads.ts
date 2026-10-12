// Small road networks for the routing tests (DECISIONS D102), written as Overpass "out geom" answers.

export type FixtureWay = { id: number; nodes: number[]; tags: Record<string, string> };

/** Node n lies at row n div 100 and column n mod 100 of a grid 0.001 degrees apart, from 23 N 90 E. */
export const nodeAt = (n: number) => ({ lat: 23 + Math.floor(n / 100) * 0.001, lon: 90 + (n % 100) * 0.001 });

export function answerOf(ways: FixtureWay[]) {
  return { elements: ways.map((way) => ({ type: "way", id: way.id, nodes: way.nodes, geometry: way.nodes.map(nodeAt), tags: way.tags })) };
}

export const road = (highway: string, more: Record<string, string> = {}) => ({ highway, ...more });
