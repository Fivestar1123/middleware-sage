import { useMemo } from 'react';
import { parseLogEntries, type LogEntry } from '@/data/mockLogs';

interface LogViewerProps {
  logContent: string;
  highlightedLines?: number[];
}

const LogViewer = ({ logContent, highlightedLines = [] }: LogViewerProps) => {
  const entries = useMemo(() => parseLogEntries(logContent), [logContent]);

  const getLineClass = (entry: LogEntry) => {
    const isHighlighted = highlightedLines.includes(entry.lineNumber);
    if (entry.level === 'ERROR' || entry.message.startsWith('\t')) return `log-line-error ${isHighlighted ? 'ring-1 ring-critical/40' : ''}`;
    if (entry.level === 'WARN') return `log-line-warning ${isHighlighted ? 'ring-1 ring-warning/40' : ''}`;
    return isHighlighted ? 'bg-primary/10 ring-1 ring-primary/30' : '';
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground font-heading">원문 로그</h3>
        <span className="text-xs text-muted-foreground">{entries.length} lines</span>
      </div>
      <div className="overflow-auto flex-1 font-mono text-xs">
        {entries.map((entry, idx) => (
          <div
            key={idx}
            className={`px-3 py-0.5 flex gap-2 hover:bg-accent/50 transition-colors ${getLineClass(entry)}`}
          >
            <span className="text-muted-foreground select-none w-6 text-right shrink-0">
              {entry.lineNumber}
            </span>
            <span className={
              entry.level === 'ERROR' ? 'text-critical' :
              entry.level === 'WARN' ? 'text-warning' :
              'text-foreground/80'
            }>
              {entry.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LogViewer;
