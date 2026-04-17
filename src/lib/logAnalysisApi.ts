import { supabase } from '@/integrations/supabase/client';
import type { AnalysisResult } from '@/data/mockLogs';
import { correlateIntervals, type CorrelatedPair } from './logCorrelation';

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
  | 'correlating'
  | 'done'
  | 'error';

export interface AnalysisProgress {
  phase: AnalysisPhase;
  percent: number;
  message: string;
}

const DIRECT_ANALYSIS_MAX_CHARS = 8_000;
const DIRECT_ANALYSIS_SUFFIX = '\n...(truncated)';

function countLines(text: string): number {
  if (!text) return 0;

  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }

  return count;
}

function buildDirectAnalysisPayload(logContent: string) {
  const truncated = logContent.length > DIRECT_ANALYSIS_MAX_CHARS;

  return {
    logContent: truncated
      ? `${logContent.slice(0, DIRECT_ANALYSIS_MAX_CHARS)}${DIRECT_ANALYSIS_SUFFIX}`
      : logContent,
    totalLines: countLines(logContent),
    truncated,
  };
}

/* ─── Store embeddings (fire-and-forget) ─── */

async function storeAnalysisEmbeddings(analyses: AnalysisResult[]) {
  if (!analyses || analyses.length === 0) return;
  try {
    await supabase.functions.invoke('embed-log', {
      body: { analyses },
    });
  } catch (e) {
    console.error('Failed to store embeddings:', e);
  }
}

/* ─── Small-file direct analysis (legacy, <50MB) ─── */

export async function analyzeLog(logContent: string): Promise<AnalysisResponse> {
  const { data, error } = await supabase.functions.invoke('analyze-log', {
    body: buildDirectAnalysisPayload(logContent),
  });
  if (error) throw new Error(error.message || 'Analysis failed');
  if (data?.error) throw new Error(data.error);
  const result = data as AnalysisResponse;
  storeAnalysisEmbeddings(result.analyses).catch(console.error);
  return result;
}

/* ─── Large-file 2-stage analysis ─── */

export async function analyzeLargeLog(
  file: File,
  onProgress: (p: AnalysisProgress) => void,
): Promise<AnalysisResponse> {
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

  // Stage 1
  onProgress({ phase: 'stage1', percent: 0, message: '1차 분석: 의심 구간 식별 중...' });

  const stage1Body = {
    stage: 1,
    summary: filterResult.summary,
    intervals: filterResult.intervals.map(iv => ({
      start: iv.start,
      end: iv.end,
      errorCount: iv.errorCount,
      lines: iv.lines.slice(0, 30),
    })),
  };

  const { data: stage1Data, error: stage1Error } = await supabase.functions.invoke('analyze-log-v2', {
    body: stage1Body,
  });

  if (stage1Error) throw new Error(stage1Error.message || 'Stage 1 failed');
  if (stage1Data?.error) throw new Error(stage1Data.error);

  const stage1: Stage1Result = stage1Data;
  onProgress({ phase: 'stage1', percent: 100, message: `${stage1.suspectIntervals.length}개 의심 구간 식별 완료` });

  // Stage 2
  onProgress({ phase: 'stage2', percent: 0, message: '2차 분석: 상세 원인 분석 중...' });

  const topIntervals = stage1.suspectIntervals
    .sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.priority] ?? 4) - (order[b.priority] ?? 4);
    })
    .slice(0, 5);

  const detailedParts: string[] = [];
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

  const result = stage2Data as AnalysisResponse;
  storeAnalysisEmbeddings(result.analyses).catch(console.error);
  return result;
}

/* ─── Multi-file correlated analysis ─── */

export async function analyzeCorrelatedLogs(
  fileA: File,
  fileB: File,
  onProgress: (p: AnalysisProgress) => void,
): Promise<AnalysisResponse> {
  // Phase 1: Filter both files in parallel via Web Workers
  onProgress({ phase: 'filtering', percent: 0, message: `파일 2개 동시 필터링 중...` });

  const [filterA, filterB] = await Promise.all([
    runWorkerFilter(fileA, (p) => {
      onProgress({ phase: 'filtering', percent: Math.round(p.percent / 2), message: `[${fileA.name}] ${p.phase}` });
    }),
    runWorkerFilter(fileB, (p) => {
      onProgress({ phase: 'filtering', percent: 50 + Math.round(p.percent / 2), message: `[${fileB.name}] ${p.phase}` });
    }),
  ]);

  onProgress({ phase: 'filtering', percent: 100, message: '필터링 완료' });

  // Phase 2: Correlate intervals by timestamp
  onProgress({ phase: 'correlating', percent: 0, message: '타임스탬프 기반 상관관계 매칭 중...' });

  const pairs = correlateIntervals(fileA.name, filterA, fileB.name, filterB);

  if (pairs.length === 0 && filterA.intervals.length === 0 && filterB.intervals.length === 0) {
    onProgress({ phase: 'done', percent: 100, message: '에러 구간이 발견되지 않았습니다.' });
    return {
      analyses: [],
      stats: { critical: 0, warning: 0, info: 0, totalLines: filterA.totalLines + filterB.totalLines },
    };
  }

  onProgress({ phase: 'correlating', percent: 100, message: `${pairs.length}개 상관 구간 매칭 완료` });

  // Phase 3: Send correlated pairs to AI (stage 3)
  onProgress({ phase: 'stage2', percent: 0, message: '통합 분석: AI 상관관계 분석 중...' });

  const correlatedData = buildCorrelatedPayload(pairs, fileA.name, filterA, fileB.name, filterB);

  const { data, error } = await supabase.functions.invoke('analyze-log-v2', {
    body: {
      stage: 3,
      correlatedLogs: correlatedData,
      fileNames: [fileA.name, fileB.name],
      summaries: [filterA.summary, filterB.summary],
      totalLines: filterA.totalLines + filterB.totalLines,
    },
  });

  if (error) throw new Error(error.message || 'Correlated analysis failed');
  if (data?.error) throw new Error(data.error);

  onProgress({ phase: 'done', percent: 100, message: '통합 분석 완료' });

  const result = data as AnalysisResponse;
  storeAnalysisEmbeddings(result.analyses).catch(console.error);
  return result;
}

function buildCorrelatedPayload(
  pairs: CorrelatedPair[],
  nameA: string,
  filterA: FilterResult,
  nameB: string,
  filterB: FilterResult,
): string {
  const parts: string[] = [];

  if (pairs.length > 0) {
    for (const pair of pairs.slice(0, 5)) {
      const linesA = pair.fileA.interval.lines.slice(0, 50).map(l => `  [${nameA}] L${l.lineNumber}: ${l.text}`).join('\n');
      const linesB = pair.fileB.interval.lines.slice(0, 50).map(l => `  [${nameB}] L${l.lineNumber}: ${l.text}`).join('\n');
      parts.push(
        `=== 상관 구간 [${pair.overlapStart} ~ ${pair.overlapEnd}] (에러 ${pair.combinedErrorCount}건) ===\n` +
        `--- ${nameA} ---\n${linesA}\n--- ${nameB} ---\n${linesB}`
      );
    }
  } else {
    // No direct correlation — send top intervals from each file independently
    const topA = filterA.intervals.slice(0, 3);
    const topB = filterB.intervals.slice(0, 3);
    for (const iv of topA) {
      const lines = iv.lines.slice(0, 40).map(l => `  [${nameA}] L${l.lineNumber}: ${l.text}`).join('\n');
      parts.push(`=== ${nameA} 주요 구간 [${iv.start} ~ ${iv.end}] (에러 ${iv.errorCount}건) ===\n${lines}`);
    }
    for (const iv of topB) {
      const lines = iv.lines.slice(0, 40).map(l => `  [${nameB}] L${l.lineNumber}: ${l.text}`).join('\n');
      parts.push(`=== ${nameB} 주요 구간 [${iv.start} ~ ${iv.end}] (에러 ${iv.errorCount}건) ===\n${lines}`);
    }
  }

  return parts.join('\n\n---\n\n');
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

/* ─── Chat streaming ─── */

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

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('로그인이 필요합니다.');
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
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
