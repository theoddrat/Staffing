// Web Worker wrapper for the Monte Carlo.
// Usage (UI): const w = new Worker(new URL('../engine/mc.worker.ts', import.meta.url), { type: 'module' });
//   w.postMessage({ type: 'init', bundle });                       // once (optional; caches the bundle)
//   w.postMessage({ type: 'run', id, params, opts });               // → { type: 'result', id, result }
//   (a 'run' message may also carry `bundle`, replacing the cached one)
// Errors come back as { type: 'error', id, message }.
import type { DataBundle } from '../types/data';
import type { MCResult, ScenarioParams } from '../types/engine';
import { runMonteCarlo } from './montecarlo';

export type McWorkerRequest =
  | { type: 'init'; bundle: DataBundle }
  | { type: 'run'; id: number | string; params: ScenarioParams; opts?: { runs?: number; seed?: number; fanTicker?: string }; bundle?: DataBundle };

export type McWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number | string; result: MCResult; ms: number }
  | { type: 'error'; id: number | string | null; message: string };

let cached: DataBundle | null = null;

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<McWorkerRequest>) => void) | null;
  postMessage: (msg: McWorkerResponse) => void;
};

ctx.onmessage = (ev: MessageEvent<McWorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      cached = msg.bundle;
      ctx.postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'run') {
      if (msg.bundle) cached = msg.bundle;
      if (!cached) throw new Error('mc.worker: no bundle (send {type:"init", bundle} first)');
      const t0 = Date.now();
      const result = runMonteCarlo(cached, msg.params, msg.opts ?? {});
      ctx.postMessage({ type: 'result', id: msg.id, result, ms: Date.now() - t0 });
    }
  } catch (e) {
    ctx.postMessage({ type: 'error', id: (msg as { id?: number | string }).id ?? null, message: String((e as Error)?.message ?? e) });
  }
};
