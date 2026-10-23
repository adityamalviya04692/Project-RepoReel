/// <reference lib="webworker" />
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

/* Embeddings run off the main thread. On WebGPU the model runs on the GPU (fp16,
   ~45 MB, ~20x faster); otherwise on the CPU via WASM (int8, ~23 MB). Either way it
   downloads once and is cached by the browser. */

export const MODEL = 'Xenova/all-MiniLM-L6-v2';
env.allowLocalModels = false;

const progress = (p: { status: string; progress?: number }) => {
  if (p.status === 'progress') self.postMessage({ type: 'load', progress: p.progress ?? 0 });
};

async function create(): Promise<FeatureExtractionPipeline> {
  if ('gpu' in navigator) {
    try {
      const m = (await pipeline('feature-extraction', MODEL, { device: 'webgpu', dtype: 'fp16', progress_callback: progress })) as FeatureExtractionPipeline;
      self.postMessage({ type: 'device', device: 'webgpu' });
      return m;
    } catch {
      /* fall back to CPU */
    }
  }
  const m = (await pipeline('feature-extraction', MODEL, { dtype: 'q8', progress_callback: progress })) as FeatureExtractionPipeline;
  self.postMessage({ type: 'device', device: 'wasm' });
  return m;
}

let extractor: Promise<FeatureExtractionPipeline> | null = null;

self.onmessage = async (e: MessageEvent<{ id: number; texts: string[] }>) => {
  const { id, texts } = e.data;
  try {
    const model = await (extractor ??= create());
    const out: Float32Array[] = [];
    const batch = 32;
    for (let i = 0; i < texts.length; i += batch) {
      const t = await model(texts.slice(i, i + batch), { pooling: 'mean', normalize: true });
      const dims = t.dims[1];
      const data = t.data as Float32Array;
      for (let r = 0; r < t.dims[0]; r++) out.push(Float32Array.from(data.subarray(r * dims, (r + 1) * dims)));
      self.postMessage({ type: 'progress', id, done: Math.min(texts.length, i + batch), total: texts.length });
    }
    self.postMessage({ type: 'done', id, vectors: out }, { transfer: out.map((v) => v.buffer) });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
