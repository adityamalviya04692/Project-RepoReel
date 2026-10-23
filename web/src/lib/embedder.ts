/* Query embeddings in a Web Worker (same MiniLM model the pipeline used for the catalog). */

let worker: Worker | null = null;
let seq = 0;
let ready = false;
const cache = new Map<string, Float32Array>();
const listeners = new Set<(p: number) => void>();

export const isReady = () => ready;
export const onLoad = (fn: (p: number) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

function boot(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./embed.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (e) => {
    if (e.data.type === 'load') listeners.forEach((fn) => fn(e.data.progress / 100));
    if (e.data.type === 'device') {
      ready = true;
      listeners.forEach((fn) => fn(1));
    }
  });
  return worker;
}

/** Starts downloading the model (call on first interaction so search is semantic by the time it's needed). */
export function warm() {
  void embedQuery('warm up').catch(() => {});
}

export function embedQuery(text: string): Promise<Float32Array> {
  const hit = cache.get(text);
  if (hit) return Promise.resolve(hit);
  const w = boot();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      if (e.data.type === 'done') {
        w.removeEventListener('message', on);
        ready = true;
        cache.set(text, e.data.vectors[0]);
        resolve(e.data.vectors[0]);
      } else if (e.data.type === 'error') {
        w.removeEventListener('message', on);
        reject(new Error(e.data.message));
      }
    };
    w.addEventListener('message', on);
    w.postMessage({ id, texts: [text] });
  });
}
