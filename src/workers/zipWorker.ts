/// <reference lib="webworker" />
import JSZip from 'jszip';

type ExtractReq = {
  id: number;
  type: 'extract';
  zipBlob: Blob;
  names: string[];
};

type GenerateReq = {
  id: number;
  type: 'generate';
  entries: { name: string; blob: Blob }[];
};

type Req = ExtractReq | GenerateReq;

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;
  try {
    if (msg.type === 'extract') {
      let zip: JSZip | null = await JSZip.loadAsync(msg.zipBlob);
      // Post each extracted chunk as it becomes available so the main thread
      // can consume progressively without holding the whole set at once.
      for (const name of msg.names) {
        const entry = zip.file(name);
        if (!entry) {
          (self as unknown as Worker).postMessage({ id: msg.id, type: 'chunk', name, blob: null });
          continue;
        }
        const blob = await entry.async('blob');
        (self as unknown as Worker).postMessage({ id: msg.id, type: 'chunk', name, blob });
        // Drop the entry from JSZip's internal store to free decompressed data.
        zip.remove(name);
      }
      zip = null;
      (self as unknown as Worker).postMessage({ id: msg.id, type: 'done' });
    } else if (msg.type === 'generate') {
      let zip: JSZip | null = new JSZip();
      for (const { name, blob } of msg.entries) {
        zip.file(name, blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      zip = null;
      (self as unknown as Worker).postMessage({ id: msg.id, type: 'zip', blob: out });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id: msg.id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
