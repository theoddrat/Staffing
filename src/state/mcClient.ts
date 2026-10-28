// Monte Carlo client for src/engine/mc.worker.ts.
// Protocol: {type:'init', bundle} once per worker, then {type:'run', id, params, opts}
//   → {type:'result', id, result, ms} | {type:'error', id, message}  ({type:'ready'} is ignored).
// One request in flight at a time; a newer request supersedes a queued one. Falls back to the
// main thread if the worker cannot be created or crashes.
import type { DataBundle } from '../types/data';
import type { MCResult, ScenarioParams } from '../types/engine';
import { runMonteCarlo } from '../engine';

export interface McOpts {
  runs?: number;
  seed?: number;
  fanTicker?: string;
}

interface Job {
  id: number;
  bundle: DataBundle;
  params: ScenarioParams;
  opts: McOpts;
  resolve: (r: MCResult) => void;
  reject: (e: unknown) => void;
}

export class McClient {
  private worker: Worker | null = null;
  private workerBundle: DataBundle | null = null;
  private workerFailed = false;
  private inflight: Job | null = null;
  private queued: Job | null = null;
  private seq = 0;

  run(bundle: DataBundle, params: ScenarioParams, opts: McOpts = {}): Promise<MCResult> {
    return new Promise<MCResult>((resolve, reject) => {
      const job: Job = { id: ++this.seq, bundle, params, opts, resolve, reject };
      if (this.inflight) {
        this.queued?.reject(new Error('superseded'));
        this.queued = job;
        return;
      }
      this.start(job);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.workerBundle = null;
  }

  private ensureWorker(bundle: DataBundle): Worker | null {
    if (this.workerFailed || typeof Worker === 'undefined') return null;
    try {
      if (!this.worker) {
        this.worker = new Worker(new URL('../engine/mc.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (ev: MessageEvent) => this.onMessage(ev.data);
        this.worker.onerror = (ev: ErrorEvent) => {
          ev.preventDefault?.();
          this.failWorker();
        };
        this.workerBundle = null;
      }
      if (this.workerBundle !== bundle) {
        this.worker.postMessage({ type: 'init', bundle });
        this.workerBundle = bundle;
      }
      return this.worker;
    } catch {
      this.failWorker();
      return null;
    }
  }

  private failWorker() {
    this.workerFailed = true;
    this.worker?.terminate();
    this.worker = null;
    this.workerBundle = null;
    const job = this.inflight;
    if (job) this.runOnMain(job);
  }

  private start(job: Job) {
    this.inflight = job;
    const w = this.ensureWorker(job.bundle);
    if (!w) {
      this.runOnMain(job);
      return;
    }
    try {
      w.postMessage({ type: 'run', id: job.id, params: job.params, opts: job.opts });
    } catch {
      this.failWorker();
    }
  }

  private runOnMain(job: Job) {
    this.inflight = job;
    setTimeout(() => {
      try {
        this.complete(job.id, runMonteCarlo(job.bundle, job.params, job.opts), null);
      } catch (e) {
        this.complete(job.id, null, e instanceof Error ? e.message : String(e));
      }
    }, 0);
  }

  private onMessage(data: unknown) {
    if (!data || typeof data !== 'object') return;
    const d = data as { type?: string; id?: number | string | null; result?: MCResult; message?: string };
    if (d.type === 'result' && d.result) this.complete(d.id ?? null, d.result, null);
    else if (d.type === 'error') this.complete(d.id ?? null, null, d.message ?? 'MC worker error');
  }

  private complete(id: number | string | null, result: MCResult | null, error: string | null) {
    const job = this.inflight;
    if (!job || (id !== null && id !== job.id)) return; // stale reply
    this.inflight = null;
    if (result) job.resolve(result);
    else job.reject(new Error(error ?? 'MC failed'));
    const next = this.queued;
    this.queued = null;
    if (next) this.start(next);
  }
}
