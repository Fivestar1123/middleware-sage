import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

interface Anomaly {
  severity: 'critical' | 'high' | 'medium';
  lineNumber: number;
  timestamp: string | null;
  message: string;
  reason: string;
  tier: 1 | 2;
}

interface AnalyzeResult {
  firstTime: string | null;
  lastTime: string | null;
  totalLines: number;
  errorCount: number;
  warnCount: number;
  anomalies: Anomaly[];
  spikes: { bucket: string; count: number; avg: number }[];
}

// Match common timestamp prefixes: [YYYY-MM-DD HH:MM:SS...] or YYYY-MM-DDTHH:MM:SS or "YYYY/MM/DD HH:MM:SS"
const TS_REGEX =
  /(\d{4}[-/]\d{2}[-/]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/;

// Tier 1 rules
const TIER1_RULES: { re: RegExp; severity: Anomaly['severity']; reason: string }[] = [
  { re: /\b(FATAL|PANIC)\b/i, severity: 'critical', reason: 'FATAL/PANIC 레벨 로그' },
  { re: /OutOfMemoryError|StackOverflowError/i, severity: 'critical', reason: '치명적 예외' },
  { re: /\bERROR\b/i, severity: 'high', reason: 'ERROR 레벨 로그' },
  { re: /Exception(?!Handler)/i, severity: 'high', reason: 'Exception 발생' },
  { re: /\bHTTP\/\d\.\d"?\s+5\d{2}\b|status[=:\s]+5\d{2}|"\s*5\d{2}\s+/i, severity: 'high', reason: 'HTTP 5xx 응답' },
  { re: /\b(timeout|timed?\s?out|deadline exceeded)\b/i, severity: 'medium', reason: 'Timeout 발생' },
  { re: /\bWARN(ING)?\b/i, severity: 'medium', reason: 'WARN 레벨 로그' },
  { re: /connection\s+(reset|refused|closed)/i, severity: 'medium', reason: '연결 이상' },
];

function extractTimestamp(line: string): string | null {
  const m = line.match(TS_REGEX);
  return m ? m[1].replace('T', ' ').replace(',', '.') : null;
}

function toDate(ts: string | null): Date | null {
  if (!ts) return null;
  const normalized = ts.replace(/\//g, '-').replace(' ', 'T');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function bucketKey(d: Date): string {
  // 1-minute buckets
  const iso = d.toISOString();
  return iso.slice(0, 16);
}

function analyze(text: string): AnalyzeResult {
  const lines = text.split('\n');
  const anomalies: Anomaly[] = [];
  let firstTime: string | null = null;
  let lastTime: string | null = null;
  let errorCount = 0;
  let warnCount = 0;

  const buckets = new Map<string, { count: number; sampleLine: number; sampleMsg: string; sampleTs: string }>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ts = extractTimestamp(line);
    if (ts) {
      if (!firstTime) firstTime = ts;
      lastTime = ts;
    }

    // Tier 1
    for (const rule of TIER1_RULES) {
      if (rule.re.test(line)) {
        if (/\bERROR\b|FATAL|Exception|OutOfMemory/i.test(line)) errorCount++;
        else if (/\bWARN/i.test(line)) warnCount++;

        if (anomalies.length < 200) {
          anomalies.push({
            severity: rule.severity,
            lineNumber: i + 1,
            timestamp: ts,
            message: line.slice(0, 300),
            reason: rule.reason,
            tier: 1,
          });
        }

        // Bucket count only for errors
        const d = toDate(ts);
        if (d && /error|fatal|exception/i.test(line)) {
          const key = bucketKey(d);
          const b = buckets.get(key);
          if (b) b.count++;
          else buckets.set(key, { count: 1, sampleLine: i + 1, sampleMsg: line.slice(0, 300), sampleTs: ts! });
        }
        break;
      }
    }
  }

  // Tier 2: statistical spike detection
  const bucketList = [...buckets.entries()];
  const spikes: AnalyzeResult['spikes'] = [];
  if (bucketList.length >= 3) {
    const counts = bucketList.map(([, v]) => v.count);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const threshold = Math.max(avg * 3, avg + 5);

    for (const [key, v] of bucketList) {
      if (v.count >= threshold) {
        spikes.push({ bucket: key, count: v.count, avg: +avg.toFixed(2) });
        anomalies.push({
          severity: v.count >= avg * 5 ? 'critical' : 'high',
          lineNumber: v.sampleLine,
          timestamp: v.sampleTs,
          message: v.sampleMsg,
          reason: `에러 급증 구간 (${v.count}건, 평균 ${avg.toFixed(1)}건의 ${(v.count / avg).toFixed(1)}배)`,
          tier: 2,
        });
      }
    }
  }

  return {
    firstTime,
    lastTime,
    totalLines: lines.length,
    errorCount,
    warnCount,
    anomalies,
    spikes,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { text } = await req.json();
    if (typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'text (string) is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = analyze(text);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
