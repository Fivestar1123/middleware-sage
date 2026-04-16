/**
 * Correlates time intervals from two log files by timestamp overlap.
 */

import type { FilterResult, TimeInterval } from './logAnalysisApi';

export interface CorrelatedPair {
  fileA: { name: string; interval: TimeInterval };
  fileB: { name: string; interval: TimeInterval };
  overlapStart: string;
  overlapEnd: string;
  combinedErrorCount: number;
}

function parseTs(ts: string): number {
  const d = new Date(ts.replace(/\//g, '-'));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Find overlapping or nearby (within gapMs) intervals between two filter results.
 */
export function correlateIntervals(
  nameA: string,
  resultA: FilterResult,
  nameB: string,
  resultB: FilterResult,
  gapMs = 5 * 60 * 1000, // 5 minutes tolerance
): CorrelatedPair[] {
  const pairs: CorrelatedPair[] = [];

  for (const ivA of resultA.intervals) {
    const aStart = parseTs(ivA.start);
    const aEnd = parseTs(ivA.end) || aStart;
    if (!aStart) continue;

    for (const ivB of resultB.intervals) {
      const bStart = parseTs(ivB.start);
      const bEnd = parseTs(ivB.end) || bStart;
      if (!bStart) continue;

      // Check overlap or proximity
      const overlapStart = Math.max(aStart, bStart);
      const overlapEnd = Math.min(aEnd, bEnd);

      if (overlapEnd - overlapStart >= -gapMs) {
        pairs.push({
          fileA: { name: nameA, interval: ivA },
          fileB: { name: nameB, interval: ivB },
          overlapStart: new Date(Math.min(aStart, bStart)).toISOString(),
          overlapEnd: new Date(Math.max(aEnd, bEnd)).toISOString(),
          combinedErrorCount: ivA.errorCount + ivB.errorCount,
        });
      }
    }
  }

  // Sort by combined error count descending, take top pairs
  pairs.sort((a, b) => b.combinedErrorCount - a.combinedErrorCount);
  return pairs.slice(0, 10);
}
