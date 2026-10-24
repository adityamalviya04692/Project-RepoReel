/* OCR in the browser (Tesseract.js, loaded only when a screenshot is dropped). Nothing is uploaded.
   Reel screenshots mix big overlay text with small dark-on-light text (a GitHub URL bar, a README), so
   the image is upscaled and greyscaled first, then read twice: once as a page and once as sparse text. */

const MIN_SIDE = 1600; // small text is read far better once it's a few dozen pixels tall

async function prepare(image: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(image);
  const scale = Math.min(3, Math.max(1, MIN_SIDE / Math.min(bmp.width, bmp.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'grayscale(1) contrast(1.15)';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? image), 'image/png'));
}

export async function readText(image: Blob, onProgress: (p: number, status: string) => void): Promise<string> {
  const { createWorker, PSM } = await import('tesseract.js');
  let pass = 0;
  const worker = await createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) =>
      onProgress(m.status === 'recognizing text' ? (pass + (m.progress ?? 0)) / 2 : m.progress ?? 0, m.status === 'recognizing text' ? `reading text, pass ${pass + 1} of 2` : m.status),
  });
  try {
    const img = await prepare(image).catch(() => image);
    const page = (await worker.recognize(img)).data.text;
    pass = 1;
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const sparse = (await worker.recognize(img)).data.text;
    const lines = [...page.split('\n'), ...sparse.split('\n')].map((l) => l.trim()).filter(Boolean);
    return [...new Set(lines)].join('\n');
  } finally {
    await worker.terminate();
  }
}
