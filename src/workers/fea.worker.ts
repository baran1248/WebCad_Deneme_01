import { FeaSettings, MaterialDef, TessellatedMesh } from '../types/cad';
import {
  generateTetrahedralMesh,
  SolidVoxelGrid,
  solveStaticFea,
} from '../utils/feaMesherAndSolver';

let cachedGrid: SolidVoxelGrid | null = null;
let cachedKey = '';

self.onmessage = (event: MessageEvent) => {
  const { id, type, payload } = event.data;
  try {
    if (type === 'GENERATE_MESH') {
      const { cadMesh, resolution, meshKey } = payload as {
        cadMesh: TessellatedMesh;
        resolution: 'coarse' | 'medium' | 'fine';
        meshKey: string;
      };
      const grid = generateTetrahedralMesh(cadMesh, resolution);
      cachedGrid = grid;
      cachedKey = `${meshKey}:${resolution}`;
      self.postMessage({ id, ok: true, result: grid.mesh });
    } else if (type === 'SOLVE_FEA') {
      const { cadMesh, material, settings, meshKey } = payload as {
        cadMesh: TessellatedMesh;
        material: MaterialDef;
        settings: FeaSettings;
        meshKey: string;
      };
      const expectedKey = `${meshKey}:${settings.meshResolution}`;
      if (!cachedGrid || cachedKey !== expectedKey) {
        cachedGrid = generateTetrahedralMesh(cadMesh, settings.meshResolution);
        cachedKey = expectedKey;
      }
      const result = solveStaticFea(cachedGrid, cadMesh, material, settings);
      self.postMessage({
        id,
        ok: true,
        result: {
          feaMesh: cachedGrid.mesh,
          feaResult: result,
        },
      });
    }
  } catch (err: any) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message ?? String(err),
    });
  }
};
