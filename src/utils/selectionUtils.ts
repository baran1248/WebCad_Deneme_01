import { SelectionFilter, VertexInfo } from '../types/cad';

/**
 * Deduplicates 3D coordinates within tolerance (default 1e-3 mm)
 * and assigns sequential vertex IDs.
 */
export function extractUniqueVertices(
  coords: Array<[number, number, number]>,
  precision = 1000
): { vertexPositions: Float32Array; vertexInfos: VertexInfo[] } {
  const seen = new Set<string>();
  const flat: number[] = [];
  const infos: VertexInfo[] = [];

  for (const [x, y, z] of coords) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const key = `${Math.round(x * precision)},${Math.round(y * precision)},${Math.round(z * precision)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const vertexId = infos.length;
    flat.push(x, y, z);
    infos.push({ vertexId, position: [x, y, z] });
  }

  return {
    vertexPositions: new Float32Array(flat),
    vertexInfos: infos,
  };
}

/**
 * Resolves which raycast target categories are allowed under the active SelectionFilter.
 */
export function getAllowedPickTargets(filter: SelectionFilter): {
  allowFace: boolean;
  allowEdge: boolean;
  allowVertex: boolean;
} {
  return {
    allowFace: filter === 'face',
    allowEdge: filter === 'edge',
    allowVertex: filter === 'vertex',
  };
}

/**
 * Toggles an ID inside a multi-select array (edges or vertices).
 */
export function toggleSelectionId(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

/**
 * Computes Euclidean distance between two 3D points (mm).
 */
export function distanceBetweenPoints(
  a: [number, number, number],
  b: [number, number, number]
): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}
