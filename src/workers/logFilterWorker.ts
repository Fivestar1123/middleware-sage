/**
 * Web Worker: Stream-reads large log files and extracts relevant lines.
 * Filters ERROR/WARN lines + context, and detects metric threshold breaches.
 */

interface FilterRequest {
  type: 'filter';
  file: File;
  keywords: string[];
  contextLines: number; // lines before/after a match to include
}

interface FilterProgress {
  type: 'progress';
  phase: string;
  percent: number;
}

interface FilteredLine {
  lineNumber: number;
  text: string;
  isMatch: boolean;
}

interface TimeInterval {
  start: string;
  end: string;
  errorCount: number;
  lines: FilteredLine[];
}

interface SeverityStats {
  critical: number;
  warning: number;
  info: number;
  totalLines: number;
}

interface FilterResult {
  type: 'result';
  totalLines: number;
  filteredLines: FilteredLine[];
  intervals: TimeInterval[];
  summary: string;
  rawLineIndex: Map<number, string>;
  severityStats: SeverityStats;
}

interface FilterResultSerialized {
  type: 'result';
  totalLines: number;
  filteredLines: FilteredLine[];
  intervals: TimeInterval[];
  summary: string;
  rawLineIndex: [number, string][];
  severityStats: SeverityStats;
}

// Regex 1차 분류 룰 (analyze-log Edge Function과 동일)
const SEVERITY_CRITICAL_RE = /\b(FATAL|CRITICAL|PANIC|EMERG|ERROR|EXCEPTION|FAIL(ED|URE)?|SEVERE)\b/i;
const SEVERITY_WARNING_RE = /\b(WARN(ING)?|DEPRECATED|RETRY)\b/i;
const SEVERITY_INFO_RE = /\b(INFO|DEBUG|TRACE|NOTICE)\b/i;

function classifyLine(line: string): 'critical' | 'warning' | 'info' | null {
  if (!line.trim()) return null;
  if (SEVERITY_CRITICAL_RE.test(line)) return 'critical';
  if (SEVERITY_WARNING_RE.test(line)) return 'warning';
  if (SEVERITY_INFO_RE.test(line)) return 'info';
  return null;
}

const TIMESTAMP_RE = /\[?([\d]{4}[-/][\d]{2}[-/][\d]{2}[\sT][\d]{2}:[\d]{2}:[\d]{2}[.\d]*)\]?/;
const ERROR_KEYWORDS = ['ERROR', 'FATAL', 'CRITICAL', 'OutOfMemoryError', 'Exception', 'SEVERE', 'FAILURE', 'FAIL'];
const WARN_KEYWORDS = ['WARN', 'WARNING', 'exceeded', 'timeout', 'overflow', 'limit'];
const METRIC_KEYWORDS = ['usage', 'utilization', 'cpu', 'memory', 'heap', 'gc', 'pool', 'thread'];

function extractTimestamp(line: string): string | null {
  const m = line.match(TIMESTAMP_RE);
  return m ? m[1] : null;
}

function isErrorLine(line: string, keywords: string[]): boolean {
  const upper = line.toUpperCase();
  for (const kw of keywords) {
    if (upper.includes(kw.toUpperCase())) return true;
  }
  for (const kw of ERROR_KEYWORDS) {
    if (upper.includes(kw)) return true;
  }
  return false;
}

function isWarnLine(line: string): boolean {
  const upper = line.toUpperCase();
  for (const kw of WARN_KEYWORDS) {
    if (upper.includes(kw)) return true;
  }
  return false;
}

function isMetricLine(line: string): boolean {
  const lower = line.toLowerCase();
  for (const kw of METRIC_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  // Check for percentage patterns like "95%", "80%"
  const pctMatch = line.match(/(\d+)%/);
  if (pctMatch && parseInt(pctMatch[1]) >= 70) return true;
  return false;
}

function groupIntoIntervals(matchedLines: FilteredLine[], allLines: string[], contextLines: number): TimeInterval[] {
  if (matchedLines.length === 0) return [];

  const intervals: TimeInterval[] = [];
  let currentInterval: FilteredLine[] = [matchedLines[0]];
  let lastTs = extractTimestamp(matchedLines[0].text);

  for (let i = 1; i < matchedLines.length; i++) {
    const line = matchedLines[i];
    const ts = extractTimestamp(line.text);

    // Group lines within 5 minutes of each other
    if (lastTs && ts) {
      const diff = Math.abs(new Date(ts).getTime() - new Date(lastTs).getTime());
      if (diff > 5 * 60 * 1000) {
        // New interval
        intervals.push(buildInterval(currentInterval, allLines, contextLines));
        currentInterval = [];
      }
    }

    currentInterval.push(line);
    if (ts) lastTs = ts;
  }

  if (currentInterval.length > 0) {
    intervals.push(buildInterval(currentInterval, allLines, contextLines));
  }

  return intervals;
}

function buildInterval(lines: FilteredLine[], allLines: string[], contextLines: number): TimeInterval {
  const firstTs = extractTimestamp(lines[0].text) || '';
  const lastTs = extractTimestamp(lines[lines.length - 1].text) || firstTs;

  // Collect context lines
  const lineNums = new Set<number>();
  for (const l of lines) {
    const start = Math.max(0, l.lineNumber - 1 - contextLines);
    const end = Math.min(allLines.length - 1, l.lineNumber - 1 + contextLines);
    for (let i = start; i <= end; i++) {
      lineNums.add(i);
    }
  }

  const matchLineNums = new Set(lines.map(l => l.lineNumber));
  const contextResult: FilteredLine[] = Array.from(lineNums)
    .sort((a, b) => a - b)
    .map(idx => ({
      lineNumber: idx + 1,
      text: allLines[idx],
      isMatch: matchLineNums.has(idx + 1),
    }));

  return {
    start: firstTs,
    end: lastTs,
    errorCount: lines.filter(l => isErrorLine(l.text, ERROR_KEYWORDS)).length,
    lines: contextResult,
  };
}

async function processFile(file: File, keywords: string[], contextLines: number) {
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunks
  const allLines: string[] = [];
  const matchedLines: FilteredLine[] = [];
  let leftover = '';
  let bytesRead = 0;
  const totalBytes = file.size;

  // Read file in chunks
  let offset = 0;
  while (offset < totalBytes) {
    const end = Math.min(offset + CHUNK_SIZE, totalBytes);
    const slice = file.slice(offset, end);
    const text = await slice.text();
    const combined = leftover + text;

    const lines = combined.split('\n');
    // Last element may be incomplete if not at EOF
    if (end < totalBytes) {
      leftover = lines.pop() || '';
    } else {
      leftover = '';
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      const lineNum = allLines.length + 1;
      allLines.push(line);

      const mergedKeywords = [...keywords, ...ERROR_KEYWORDS];
      if (isErrorLine(line, mergedKeywords) || isWarnLine(line) || isMetricLine(line)) {
        matchedLines.push({ lineNumber: lineNum, text: line, isMatch: true });
      }
    }

    offset = end;
    bytesRead = end;

    self.postMessage({
      type: 'progress',
      phase: '데이터 추출 및 필터링 중...',
      percent: Math.round((bytesRead / totalBytes) * 80),
    } as FilterProgress);
  }

  // Handle leftover
  if (leftover.trim()) {
    const lineNum = allLines.length + 1;
    allLines.push(leftover);
    if (isErrorLine(leftover, [...keywords, ...ERROR_KEYWORDS]) || isWarnLine(leftover) || isMetricLine(leftover)) {
      matchedLines.push({ lineNumber: lineNum, text: leftover, isMatch: true });
    }
  }

  self.postMessage({
    type: 'progress',
    phase: '의심 구간 그룹화 중...',
    percent: 85,
  } as FilterProgress);

  // Group into time intervals
  const intervals = groupIntoIntervals(matchedLines, allLines, contextLines);

  self.postMessage({
    type: 'progress',
    phase: '요약 생성 중...',
    percent: 95,
  } as FilterProgress);

  // Build summary
  const errorCount = matchedLines.filter(l => isErrorLine(l.text, ERROR_KEYWORDS)).length;
  const warnCount = matchedLines.filter(l => isWarnLine(l.text)).length;
  const summary = `총 ${allLines.length}줄 중 ERROR ${errorCount}건, WARNING ${warnCount}건 감지. ${intervals.length}개 의심 구간 식별.`;

  // Build line index for context retrieval (only around intervals)
  const lineIndex: [number, string][] = [];
  for (const interval of intervals) {
    for (const l of interval.lines) {
      lineIndex.push([l.lineNumber, l.text]);
    }
  }

  self.postMessage({
    type: 'result',
    totalLines: allLines.length,
    filteredLines: matchedLines,
    intervals,
    summary,
    rawLineIndex: lineIndex,
  } as FilterResultSerialized);
}

self.onmessage = async (e: MessageEvent<FilterRequest>) => {
  const { file, keywords, contextLines } = e.data;
  try {
    await processFile(file, keywords || ['ERROR'], contextLines || 5);
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Worker error',
    });
  }
};
