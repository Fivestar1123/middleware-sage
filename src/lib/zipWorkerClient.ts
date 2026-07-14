// Client wrapper around the JSZip web worker.
type WorkerOutMsg =
  | { id: number; type: 'chunk'; name: string; blob: Blob | null }
  | { id: number; type: 'done' }
  | { id: number; type: 'zip'; blob: Blob }
  | { id: number; type: 'error'; error: string };

let worker: Worker | null = null;
let nextId = 1;

const getWorker = () => {
  if (!worker) {
    worker = new Worker(new URL('../workers/zipWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
};

export const terminateZipWorker = () => {
  worker?.terminate();
  worker = null;
};

export const extractZipStream = (
  zipBlob: Blob,
  names: string[],
  onChunk: (name: string, blob: Blob | null) => void | Promise<void>,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = nextId++;
    const handler = async (e: MessageEvent<WorkerOutMsg>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'chunk') {
        await onChunk(msg.name, msg.blob);
      } else if (msg.type === 'done') {
        w.removeEventListener('message', handler);
        resolve();
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(msg.error));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ id, type: 'extract', zipBlob, names });
  });
};

export const generateZipInWorker = (
  entries: { name: string; blob: Blob }[],
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = nextId++;
    const handler = (e: MessageEvent<WorkerOutMsg>) => {
      const msg = e.data;
      if (msg.id !== id) return;
      if (msg.type === 'zip') {
        w.removeEventListener('message', handler);
        resolve(msg.blob);
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(msg.error));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ id, type: 'generate', entries });
  });
};
