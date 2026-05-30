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

export interface SeverityStats {
  critical: number;
  warning: number;
  info: number;
  totalLines: number;
}

export interface FilterResult {
  totalLines: number;
  filteredLines: FilteredLine[];
  intervals: TimeInterval[];
  summary: string;
  rawLineIndex: [number, string][];
  severityStats: SeverityStats;
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

const STAGE1_PROMPT = `너는 LogMind야. 사용자가 대용량 로그에서 필터링된 요약 데이터를 제공한다.

네 역할:
1. 제공된 에러/경고 요약과 의심 구간 정보를 분석
2. 각 의심 구간의 위험도를 평가
3. 상세 분석이 필요한 구간을 우선순위로 정렬하여 반환

반드시 아래 JSON 형식만 반환해. 다른 텍스트 없이 JSON만:
{
  "suspectIntervals": [
    {
      "intervalIndex": 0,
      "priority": "critical",
      "reason": "이유 설명",
      "timeRange": "시작 ~ 끝"
    }
  ],
  "overallAssessment": "전체 평가"
}`;

const STAGE2_PROMPT = `너는 LogMind야. JEUS, WebtoB, Apache, Tomcat 등 공공기관 미들웨어 로그를 분석하는 전문가야.

1차 분석에서 의심 구간으로 특정된 상세 로그를 제공한다.
각 구간별로 최종 장애 원인을 분석하고 조치 가이드를 제시해.

분석 시 특히 주의할 패턴:
- OutOfMemoryError, GC overhead limit exceeded → 메모리 누수
- abnormal closed, connection reset → 비정상 세션 종료
- not closed, connection pool → 커넥션 풀 이슈
- Thread pool exceeded → 스레드 풀 포화
- timeout → 타임아웃
- Full GC, STW → GC 관련 장애

반드시 아래 JSON 형식만 반환해. 다른 텍스트 없이 JSON만:
{
  "analyses": [
    {
      "severity": "critical",
      "title": "제목",
      "cause": "원인",
      "recommendation": "권장조치",
      "impact": "영향범위",
      "relatedLines": [1, 2, 3],
      "timeRange": "시간범위"
    }
  ],
  "stats": {
    "critical": 0,
    "warning": 0,
    "info": 0,
    "totalLines": 0
  }
}`;

const STAGE3_PROMPT = `너는 LogMind야. JEUS, WebtoB, Apache, Tomcat 등 공공기관 미들웨어 로그를 분석하는 전문가야.

두 개의 서로 다른 로그 파일에서 추출된 에러 구간이 제공된다.

네 역할:
1. 두 파일의 에러 구간 간 인과관계 분석
2. 각 파일의 독립적인 문제 별도 분석
3. 두 시스템 간의 연쇄 장애 가능성 판단
4. 통합 조치 가이드 제시

반드시 아래 JSON 형식만 반환해. 다른 텍스트 없이 JSON만:
{
  "analyses": [
    {
      "severity": "critical",
      "title": "제목",
      "cause": "원인",
      "recommendation": "권장조치",
      "impact": "영향범위",
      "relatedLines": [1, 2, 3],
      "timeRange": "시간범위"
    }
  ],
  "stats": {
    "critical": 0,
    "warning": 0,
    "info": 0,
    "totalLines": 0
  }
}`;


function countLines(text: string): number {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

/* ─── Ollama 직접 호출 ─── */

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL || 'http://192.168.28.1:11434';
const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL || 'qwen2.5:3b';

async function callOllama(systemPrompt: string, userContent: string): Promise<any> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent.slice(0, 6000) },
      ],
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        num_predict: 8192,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama 호출 실패: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.message?.content || '';

  console.log('=== Ollama 응답 원문 ===', content.slice(0, 300));

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error('Ollama 응답 JSON 파싱 실패');
    }
  }

  throw new Error('Ollama 응답에서 JSON을 찾을 수 없습니다');
}

/* ─── Qdrant 임베딩 저장 (fire-and-forget) ─── */

const QDRANT_URL = import.meta.env.VITE_QDRANT_URL || 'http://192.168.28.128:6333';
const QDRANT_COLLECTION = 'log_embeddings';
const KRSBERT_URL = import.meta.env.VITE_KRSBERT_URL || 'http://192.168.28.128:8001';

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${KRSBERT_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [text.slice(0, 200)] }),
    });
    if (!response.ok) throw new Error('KR-SBERT 호출 실패');
    const data = await response.json();
    return data.embeddings[0];
  } catch (e) {
    console.error('KR-SBERT embedding 실패, 폴백 사용:', e);
    // 폴백 — 768차원 랜덤 벡터
    return Array.from({ length: 768 }, () => Math.random() * 0.01);
  }
}

/* ─── Store embeddings (fire-and-forget) ─── */

async function storeAnalysisEmbeddings(analyses: AnalysisResult[]) {
  if (!analyses || analyses.length === 0) return;
  try {
    const points = await Promise.all(analyses.map(async (a, i) => {
      const text = `${a.title} ${a.cause} ${a.recommendation} ${a.impact}`;
      return {
        id: Date.now() + i,
        vector: await generateEmbedding(text),
        payload: {
          title: a.title,
          cause: a.cause || '',
          recommendation: a.recommendation || '',
          impact: a.impact || '',
          severity: a.severity,
          content: text.slice(0, 1000),
          created_at: new Date().toISOString(),
        },
      };
    }));

    const res = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
    });
    if (!res.ok) throw new Error('Qdrant 저장 실패');
    console.log(`Qdrant에 ${points.length}개 임베딩 저장 완료`);
  } catch (e) {
    console.error('Failed to store embeddings in Qdrant:', e);
  }
}

/* ─── Large-file 2-stage analysis (Ollama) ─── */

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

  const stage1UserContent = `다음은 대용량 로그 파일에서 필터링된 요약 정보야:\n\n${filterResult.summary}\n\n의심 구간 목록:\n${
    filterResult.intervals.map((iv, i) =>
      `[구간 ${i}] 시간: ${iv.start} ~ ${iv.end}, 에러 ${iv.errorCount}건, 샘플:\n${
        iv.lines.slice(0, 20).map(l => `  L${l.lineNumber}: ${l.text}`).join('\n')
      }`
    ).join('\n\n')
  }`;

  const stage1: Stage1Result = await callOllama(STAGE1_PROMPT, stage1UserContent);
  onProgress({ phase: 'stage1', percent: 100, message: `${stage1.suspectIntervals?.length ?? 0}개 의심 구간 식별 완료` });

  // Stage 2
  onProgress({ phase: 'stage2', percent: 0, message: '2차 분석: 상세 원인 분석 중...' });

  const topIntervals = (stage1.suspectIntervals || [])
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

  const stage2UserContent = `다음은 1차 분석에서 의심 구간으로 특정된 상세 로그야. 총 원본 라인 수: ${filterResult.totalLines}\n\n${detailedParts.join('\n\n---\n\n')}`;

  const stage2Result = await callOllama(STAGE2_PROMPT, stage2UserContent);
  onProgress({ phase: 'done', percent: 100, message: '분석 완료' });

  const result = stage2Result as AnalysisResponse;
  result.stats = filterResult.severityStats;
  storeAnalysisEmbeddings(result.analyses).catch(console.error);
  return result;
}

/* ─── Multi-file correlated analysis (Ollama) ─── */

export async function analyzeCorrelatedLogs(
  fileA: File,
  fileB: File,
  onProgress: (p: AnalysisProgress) => void,
): Promise<AnalysisResponse> {
  onProgress({ phase: 'filtering', percent: 0, message: '파일 2개 동시 필터링 중...' });

  const [filterA, filterB] = await Promise.all([
    runWorkerFilter(fileA, (p) => {
      onProgress({ phase: 'filtering', percent: Math.round(p.percent / 2), message: `[${fileA.name}] ${p.phase}` });
    }),
    runWorkerFilter(fileB, (p) => {
      onProgress({ phase: 'filtering', percent: 50 + Math.round(p.percent / 2), message: `[${fileB.name}] ${p.phase}` });
    }),
  ]);

  onProgress({ phase: 'filtering', percent: 100, message: '필터링 완료' });
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
  onProgress({ phase: 'stage2', percent: 0, message: '통합 분석: AI 상관관계 분석 중...' });

  const correlatedData = buildCorrelatedPayload(pairs, fileA.name, filterA, fileB.name, filterB);

  const userContent = `두 개의 로그 파일을 통합 분석해줘.

파일 목록: ${fileA.name}, ${fileB.name}
요약:
  [${fileA.name}] ${filterA.summary}
  [${fileB.name}] ${filterB.summary}
총 라인 수: ${filterA.totalLines + filterB.totalLines}

아래는 타임스탬프 기반으로 매칭된 상관 구간이야:

${correlatedData}`;

  const result = await callOllama(STAGE3_PROMPT, userContent) as AnalysisResponse;
  result.stats = {
    critical: filterA.severityStats.critical + filterB.severityStats.critical,
    warning: filterA.severityStats.warning + filterB.severityStats.warning,
    info: filterA.severityStats.info + filterB.severityStats.info,
    totalLines: filterA.totalLines + filterB.totalLines,
  };

  onProgress({ phase: 'done', percent: 100, message: '통합 분석 완료' });
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
    for (const iv of filterA.intervals.slice(0, 3)) {
      const lines = iv.lines.slice(0, 40).map(l => `  [${nameA}] L${l.lineNumber}: ${l.text}`).join('\n');
      parts.push(`=== ${nameA} 주요 구간 [${iv.start} ~ ${iv.end}] (에러 ${iv.errorCount}건) ===\n${lines}`);
    }
    for (const iv of filterB.intervals.slice(0, 3)) {
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
          severityStats: msg.severityStats ?? {
            critical: 0, warning: 0, info: 0, totalLines: msg.totalLines,
          },
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

/* ─── Chat streaming (Ollama) ─── */

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
  const systemContent = `너는 LogMind야. JEUS, WebtoB, Apache, Tomcat 등 공공기관 미들웨어 로그를 분석하는 전문가야.
사용자가 로그 분석 결과에 대해 질문하면 친절하고 정확하게 답변해줘.
${logContext ? `\n\n현재 분석 중인 로그 컨텍스트:\n${logContext.slice(0, 3000)}` : ''}`;

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemContent },
        ...messages,
      ],
      stream: true,
      options: {
        temperature: 0.3,
        num_predict: 2048,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama 스트리밍 실패: ${response.status}`);
  }

  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          onDelta(parsed.message.content);
        }
        if (parsed.done) {
          onDone();
          return;
        }
      } catch {
        // 불완전한 JSON 청크 무시
      }
    }
  }

  onDone();
}

/* ─── Small-file direct analysis (Ollama) ─── */

export async function analyzeLog(
  logContent: string,
  priorContext?: { previousLog?: string; previousResults?: AnalysisResult[] },
): Promise<AnalysisResponse> {
  let finalContent = logContent;

  if (priorContext?.previousLog || (priorContext?.previousResults && priorContext.previousResults.length > 0)) {
    const priorSummary = (priorContext.previousResults || [])
      .map((r, i) => `[${i + 1}] (${r.severity.toUpperCase()}) ${r.title}\n  - 원인: ${(r.cause || '').slice(0, 200)}\n  - 권장조치: ${(r.recommendation || '').slice(0, 200)}`)
      .join('\n');
    const prevLogSnippet = (priorContext.previousLog || '').slice(0, 4000);
    finalContent =
      `===== [1차 분석 컨텍스트] 이전 로그 (요약) =====\n${prevLogSnippet}\n` +
      (priorSummary ? `\n===== [1차 분석 컨텍스트] 이전 AI 분석 결과 =====\n${priorSummary}\n` : '') +
      `\n===== [추가 업로드된 신규 로그] — 이전 컨텍스트와 연관지어 분석하세요 =====\n${logContent}`;
  }

  const truncated = finalContent.length > 8000;
  const logSlice = truncated
    ? `${finalContent.slice(0, 8000)}\n...(truncated)`
    : finalContent;

  const userContent = `다음 로그를 분석해줘. 총 라인 수: ${countLines(logSlice)}\n\n${logSlice}`;
  const result = await callOllama(STAGE2_PROMPT, userContent) as AnalysisResponse;
  result.stats = result.stats || { critical: 0, warning: 0, info: 0, totalLines: countLines(logSlice) };
  storeAnalysisEmbeddings(result.analyses).catch(console.error);
  return result;
}
