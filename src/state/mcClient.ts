// Monte Carlo client: runs the engine's MC in a Web Worker (src/engine/mc.worker.ts), one request
// in flight at a time (newer requests replace queued ones). Falls back to the main thread if the
// worker cannot be created or errors.
import type { DataBundle } from '../types/data';
import type { MCResult, ScenarioParams } from '../types/engine';
import { runMonteCarlo } from '../engine';

export interface McOpts {
  runs?: number;
  seed?: number;
  fanTicker?: string;
}

interface Job {
  bundle: DataBundle;
  params: ScenarioParams;
  opts: McOpts;
  resolve: (r: MCResult) => void;
  reject: (e: unknown) => void;
}

function asResult(data: unknown): MCResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if ('perStock' in d) return d as unknown as MCResult;
  if (d.result && typeof d.result === 'object' && 'perStock' in (d.result as object)) return d.result as MCResult;
  if (d.mc && typeof d.mc === 'object' && 'perStock' in (d.mc as object)) return d.mc as MCResult;
  return null;
}

export class McClient {
  private worker: Worker | null = null;
  private workerFailed = false;
  private inflight: Job | null = null;
  private queued: Job | null = null;

  run(bundle: DataBundle, params: ScenarioParams, opts: McOpts = {}): Promise<MCResult> {
    return new Promise<MCResult>((resolve, reject) => {
      const job: Job = { bundle, params, opts, resolve, reject };
      if (this.inflight) {
        // Supersede any queued job: its caller gets a rejection it can ignore.
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
  }

  private ensureWorker(): Worker | null {
    if (this.workerFailed) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('../engine/mc.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent) => this.finish(ev.data);
      this.worker.onerror = (ev: ErrorEvent) => {
        ev.preventDefault?.();
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = null;
        const job = this.inflight;
        this.inflight = null;
        if (job) this.runOnMain(job);
      };
      return this.worker;
    } catch {
      this.workerFailed = true;
      return null;
    }
  }

  private start(job: Job) {
    this.inflight = job;
    const w = this.ensureWorker();
    if (!w) {
      this.runOnMain(job);
      return;
    }
    try {
      w.postMessage({ bundle: job.bundle, params: job.params, opts: job.opts });
    } catch {
      this.workerFailed = true;
      this.runOnMain(job);
    }
  }

  private runOnMain(job: Job) {
    this.inflight = job;
    setTimeout(() => {
      try {
        const r = runMonteCarlo(job.bundle, job.params, job.opts);
        this.finish(r);
      } catch (e) {
        this.finish({ error: String(e) });
      }
    }, 0);
  }

  private finish(data: unknown) {
    const job = this.inflight;
    this.inflight = null;
    if (job) {
      const r = asResult(data);
      if (r) job.resolve(r);
      else {
        const msg = data && typeof data === 'object' && 'error' in (data as object) ? String((data as { error: unknown }).error) : 'bad MC response';
        job.reject(new Error(msg));
      }
    }
    const next = this.queued;
    this.queued = null;
    if (next) this.start(next);
  }
}
