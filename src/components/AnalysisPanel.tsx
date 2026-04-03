import { AlertOctagon, AlertTriangle, Info, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { type AnalysisResult } from '@/data/mockLogs';

interface AnalysisPanelProps {
  results: AnalysisResult[];
  onHoverLines?: (lines: number[]) => void;
  isLoading?: boolean;
}

const severityConfig = {
  critical: { icon: AlertOctagon, label: 'CRITICAL', colorClass: 'text-critical border-critical/30 bg-critical/5' },
  warning: { icon: AlertTriangle, label: 'WARNING', colorClass: 'text-warning border-warning/30 bg-warning/5' },
  info: { icon: Info, label: 'INFO', colorClass: 'text-info border-info/30 bg-info/5' },
};

const AnalysisPanel = ({ results, onHoverLines }: AnalysisPanelProps) => {
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground font-heading">AI 분석 결과</h3>
      </div>
      <div className="overflow-auto flex-1 p-2 space-y-2">
        {results.map((result, idx) => {
          const config = severityConfig[result.severity];
          const Icon = config.icon;
          const isOpen = expanded === idx;

          return (
            <div
              key={idx}
              className={`border rounded-md overflow-hidden transition-colors ${config.colorClass}`}
              onMouseEnter={() => onHoverLines?.(result.relatedLines)}
              onMouseLeave={() => onHoverLines?.([])}
            >
              <button
                onClick={() => setExpanded(isOpen ? null : idx)}
                className="w-full px-3 py-2 flex items-center gap-2 text-left"
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs font-semibold flex-1">{result.title}</span>
                <span className="text-[10px] opacity-60 font-mono">{config.label}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-foreground mb-0.5">🔍 장애 원인 추정</p>
                    <p className="text-muted-foreground leading-relaxed">{result.cause}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground mb-0.5">✅ 권장 조치 가이드</p>
                    <pre className="text-muted-foreground whitespace-pre-wrap leading-relaxed">{result.recommendation}</pre>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground mb-0.5">⚠️ 예상 영향 범위</p>
                    <p className="text-muted-foreground leading-relaxed">{result.impact}</p>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    관련 라인: {result.relatedLines.join(', ')}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AnalysisPanel;
