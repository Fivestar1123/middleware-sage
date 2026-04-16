import { supabase } from '@/integrations/supabase/client';
import type { AnalysisResult } from '@/data/mockLogs';

/* ─── Types ─── */

export interface FilteredLine {
  lineNumber: number;
  text: string;
  isMatch: boolean;
}

export interface TimeInterval {
  start: string;
  end: string;
  errorCount: number;
  lines: FilteredLine[];
}

export interface FilterResult {
  totalLines: number;
  filteredLines: FilteredLine[];
  intervals: TimeInterval[];
  summary: string;
  rawLineIndex: [number, string][];
}

interface Stage1Result {
  suspectIntervals: {
    intervalIndex: number;
    priority: string;
    reason: string;
    timeRange: string;
  }[];
  overallAssessment: string;
}

export interface AnalysisResponse {
  analyses: AnalysisResult[];
  stats: {
    critical: number;
    warning: number;
    info: number;
    totalLines: number;
  };
}

export type AnalysisPhase =
  | 'filtering'
  | 'stage1'
  | 'stage2'
  | 'done'
  | 'error';

export interface AnalysisProgress {
  phase: AnalysisPhase;
  percent: number;
  message: string;
}

/* ─── Small-file direct analysis (legacy, <50MB) ─── */

export async function analyzeLog(logContent: string): Promise<AnalysisResponse> {
  const { data, error } = await supabase.functions.invoke('analyze-log', {
    body: { logContent },
  });
  if (error) throw new Error(error.message || 'Analysis failed');
  if (data?.error) throw new Error(data.error);
  const result = data as AnalysisResponse;

  // Store analysis results as embeddings (fire-and-forget)
  storeAnalysisEmbeddings(result.analyses).catch(console.error);

  return result;
}

/* ─── Large-file 2-stage analysis ─── */

export async function analyzeLargeLog(
  file: File,
  onProgress: (p: AnalysisProgress) => void,
): Promise<AnalysisResponse> {
  // Phase 1: Filter in Web Worker
  onProgress({ phase: 'filtering', percent: 0, message: '데이터 추출 및 필터링 중...' });

  const filterResult = await runWorkerFilter(file, (p) => {
    onProgress({ phase: 'filtering', percent: p.percent, message: p.phase });
  });

  if (filterResult.intervals.length === 0) {
    onProgress({ phase: 'done', percent: 100, message: '분석 완료' });
    return {
      analyses: [],
      stats: { critical: 0, warning: 0, info: 0, totalLines: filterResult.totalLines },
    };
  }

  // Phase 2: Stage 1 - Identify suspect intervals
  onProgress({ phase: 'stage1', percent: 0, message: '1차 분석: 의심 구간 식별 중...' });

  const stage1Body = {
    stage: 1,
    summary: filterResult.summary,
    intervals: filterResult.intervals.map(iv => ({
      start: iv.start,
      end: iv.end,
      errorCount: iv.errorCount,
      lines: iv.lines.slice(0, 30), // Send sample lines
    })),
  };

  const { data: stage1Data, error: stage1Error } = await supabase.functions.invoke('analyze-log-v2', {
    body: stage1Body,
  });

  if (stage1Error) throw new Error(stage1Error.message || 'Stage 1 failed');
  if (stage1Data?.error) throw new Error(stage1Data.error);

  const stage1: Stage1Result = stage1Data;
  onProgress({ phase: 'stage1', percent: 100, message: `${stage1.suspectIntervals.length}개 의심 구간 식별 완료` });

  // Phase 3: Stage 2 - Deep analysis of top suspect intervals
  onProgress({ phase: 'stage2', percent: 0, message: '2차 분석: 상세 원인 분석 중...' });

  // Get top priority intervals (max 5)
  const topIntervals = stage1.suspectIntervals
    .sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] ?? 4) - (order[b.priority] ?? 4);
    })
    .slice(0, 5);

  // Build detailed logs: ±100 lines around each suspect interval
  const detailedParts: string[] = [];
  const lineMap = new Map(filterResult.rawLineIndex);

  for (const suspect of topIntervals) {
    const interval = filterResult.intervals[suspect.intervalIndex];
    if (!interval) continue;

    const lines = interval.lines.map(l => `L${l.lineNumber}: ${l.text}`).join('\n');
    detailedParts.push(
      `=== 의심 구간 [${suspect.timeRange}] (우선순위: ${suspect.priority}) ===\n사유: ${suspect.reason}\n\n${lines}`
    );
  }

  const { data: stage2Data, error: stage2Error } = await supabase.functions.invoke('analyze-log-v2', {
    body: {
      stage: 2,
      detailedLogs: detailedParts.join('\n\n---\n\n'),
      totalLines: filterResult.totalLines,
    },
  });

  if (stage2Error) throw new Error(stage2Error.message || 'Stage 2 failed');
  if (stage2Data?.error) throw new Error(stage2Data.error);

  onProgress({ phase: 'done', percent: 100, message: '분석 완료' });

  return stage2Data as AnalysisResponse;
}

/* ─── Web Worker wrapper ─── */

function runWorkerFilter(
  file: File,
  onProgress: (p: { phase: string; percent: number }) => void,
): Promise<FilterResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/logFilterWorker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress({ phase: msg.phase, percent: msg.percent });
      } else if (msg.type === 'result') {
        resolve({
          totalLines: msg.totalLines,
          filteredLines: msg.filteredLines,
          intervals: msg.intervals,
          summary: msg.summary,
          rawLineIndex: msg.rawLineIndex,
        });
        worker.terminate();
      } else if (msg.type === 'error') {
        reject(new Error(msg.message));
        worker.terminate();
      }
    };

    worker.onerror = (err) => {
      reject(new Error(err.message || 'Worker failed'));
      worker.terminate();
    };

    worker.postMessage({ type: 'filter', file, keywords: ['ERROR'], contextLines: 100 });
  });
}

/* ─── Chat streaming (unchanged) ─── */

type Msg = { role: 'user' | 'assistant'; content: string };

export async function streamChatLog({
  messages,
  logContext,
  onDelta,
  onDone,
}: {
  messages: Msg[];
  logContext: string;
  onDelta: (text: string) => void;
  onDone: () => void;
}) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-log`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ messages, logContext }),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error || `Request failed (${resp.status})`);
  }

  if (!resp.body) throw new Error('No response body');

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamDone = false;

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.startsWith(':') || line.trim() === '') continue;
      if (!line.startsWith('data: ')) continue;

      const jsonStr = line.slice(6).trim();
      if (jsonStr === '[DONE]') {
        streamDone = true;
        break;
      }

      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      } catch {
        buffer = line + '\n' + buffer;
        break;
      }
    }
  }

  if (buffer.trim()) {
    for (let raw of buffer.split('\n')) {
      if (!raw) continue;
      if (raw.endsWith('\r')) raw = raw.slice(0, -1);
      if (!raw.startsWith('data: ')) continue;
      const jsonStr = raw.slice(6).trim();
      if (jsonStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      } catch { /* ignore */ }
    }
  }

  onDone();
}
