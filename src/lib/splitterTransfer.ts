// In-memory transfer between FileSplitter and Index pages.
// Avoids sessionStorage quota errors on large chunks.
let pending: { content: string; filename: string } | null = null;

export const setPendingSplitterChunk = (content: string, filename: string) => {
  pending = { content, filename };
};

export const consumePendingSplitterChunk = () => {
  const v = pending;
  pending = null;
  return v;
};
