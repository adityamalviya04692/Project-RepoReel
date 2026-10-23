/* OCR in the browser (Tesseract.js, loaded only when a screenshot is dropped). Nothing is uploaded. */
export async function readText(image: Blob, onProgress: (p: number, status: string) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => onProgress(m.progress ?? 0, m.status),
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
