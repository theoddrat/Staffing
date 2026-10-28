// Web Worker wrapper for the Monte Carlo.
// Usage (UI): const w = new Worker(new URL('../engine/mc.worker.ts', import.meta.url), { type: 'module' });
//   w.postMessage({ type: 'init', bundle });                 // optional: cache the bundle once
//   w.postMessage({ type: 'run', id, params, opts });         // → { type: 'result', id, result, ms }
//   w.postMessage({ bundle, params, opts });                  // untyped form (also accepted): runs immediately
// A run message may carry `bundle` (replaces the cached one). Errors: { type: 'error', id, message, error }.
import type { DataBundle } from '../types/data';
import type { MCResult, ScenarioParams } from '../types/engine';
import { runMonteCarlo } from './montecarlo';

type McOpts = { runs?: number; seed?: number; fanTicker?: string };

export type McWorkerRequest =
  | { type: 'init'; bundle: DataBundle }
  | { type?: 'run'; id?: number | string; params: ScenarioParams; opts?: McOpts; bundle?: DataBundle };

export type McWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number | string | null; result: MCResult; ms: number }
  | { type: 'error'; id: number | string | null; message: string; error: string };

let cached: DataBundle | null = null;

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<McWorkerRequest>) => void) | null;
  postMessage: (msg: McWorkerResponse) => void;
};

ctx.onmessage = (ev: MessageEvent<McWorkerRequest>) => {
  const msg = ev.data;
  const id = msg && 'id' in msg ? (msg.id ?? null) : null;
  try {
    if (msg && msg.type === 'init') {
      cached = msg.bundle;
      ctx.postMessage({ type: 'ready' });
      return;
    }
    if (!msg || !('params' in msg)) throw new Error('mc.worker: message needs {params}');
    if (msg.bundle) cached = msg.bundle;
    if (!cached) throw new Error('mc.worker: no bundle (send {type:"init", bundle} first or include bundle)');
    const t0 = Date.now();
    const result = runMonteCarlo(cached, msg.params, msg.opts ?? {});
    ctx.postMessage({ type: 'result', id, result, ms: Date.now() - t0 });
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    ctx.postMessage({ type: 'error', id, message, error: message });
  }
};
