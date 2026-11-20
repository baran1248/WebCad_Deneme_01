import {
  FeaMeshData,
  FeaResult,
  FeaSettings,
  GeometryCheckResult,
  MaterialDef,
  PartDefinition,
  TessellatedMesh,
} from '../types/cad';

type PendingReq = {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
};

class WorkerRpcClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, PendingReq>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ok, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error ?? 'Worker execution error'));
    };
    this.worker.onerror = (err) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(err.message || 'Worker crashed'));
      }
      this.pending.clear();
    };
  }

  call<T>(type: string, payload: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }
}

let occtClient: WorkerRpcClient | null = null;
let feaClient: WorkerRpcClient | null = null;

function getOcctClient(): WorkerRpcClient {
  if (!occtClient) {
    const w = new Worker(new URL('../workers/occt.worker.ts', import.meta.url), {
      type: 'module',
    });
    occtClient = new WorkerRpcClient(w);
  }
  return occtClient;
}

function getFeaClient(): WorkerRpcClient {
  if (!feaClient) {
    const w = new Worker(new URL('../workers/fea.worker.ts', import.meta.url), {
      type: 'module',
    });
    feaClient = new WorkerRpcClient(w);
  }
  return feaClient;
}

export async function buildPartInWorker(part: PartDefinition): Promise<TessellatedMesh> {
  return getOcctClient().call<TessellatedMesh>('BUILD_PART', { part });
}

export async function exportStepInWorker(part: PartDefinition): Promise<string> {
  return getOcctClient().call<string>('EXPORT_STEP', { part });
}

export async function exportStlOcctInWorker(part: PartDefinition): Promise<Uint8Array> {
  return getOcctClient().call<Uint8Array>('EXPORT_STL_OCCT', { part });
}

export async function importStepInWorker(stepText: string): Promise<TessellatedMesh> {
  return getOcctClient().call<TessellatedMesh>('IMPORT_STEP', { stepText });
}

export async function checkGeometryInWorker(
  part: PartDefinition
): Promise<GeometryCheckResult> {
  return getOcctClient().call<GeometryCheckResult>('CHECK_GEOMETRY', { part });
}

export async function generateFeaMeshInWorker(
  cadMesh: TessellatedMesh,
  resolution: 'coarse' | 'medium' | 'fine',
  meshKey: string
): Promise<FeaMeshData> {
  return getFeaClient().call<FeaMeshData>('GENERATE_MESH', {
    cadMesh,
    resolution,
    meshKey,
  });
}

export async function solveFeaInWorker(
  cadMesh: TessellatedMesh,
  material: MaterialDef,
  settings: FeaSettings,
  meshKey: string
): Promise<{ feaMesh: FeaMeshData; feaResult: FeaResult }> {
  return getFeaClient().call<{ feaMesh: FeaMeshData; feaResult: FeaResult }>('SOLVE_FEA', {
    cadMesh,
    material,
    settings,
    meshKey,
  });
}
