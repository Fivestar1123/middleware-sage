import { useState, useEffect } from 'react';
import { History, Trash2, Clock, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { type AnalysisResult } from '@/data/mockLogs';
import { toast } from '@/hooks/use-toast';

interface HistoryEntry {
  id: string;
  filename: string;
  log_content: string;
  results: AnalysisResult[];
  stats: { critical: number; warning: number; info: number; totalLines: number };
  created_at: string;
}

interface AnalysisHistoryProps {
  onLoad: (logContent: string, results: AnalysisResult[], stats: HistoryEntry['stats'], filename: string) => void;
}

const AnalysisHistory = ({ onLoad }: AnalysisHistoryProps) => {
  const { user } = useAuth();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('analysis_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Failed to fetch history:', error);
    } else {
      setHistory((data ?? []).map((d: any) => ({
        ...d,
        results: d.results as AnalysisResult[],
        stats: d.stats as HistoryEntry['stats'],
      })));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchHistory();
  }, [user]);

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('analysis_history').delete().eq('id', id);
    if (error) {
      toast({ title: '삭제 실패', description: error.message, variant: 'destructive' });
    } else {
      setHistory(prev => prev.filter(h => h.id !== id));
      toast({ title: '삭제 완료' });
    }
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 이력 불러오는 중...
      </div>
    );
  }

  if (history.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <History className="w-3.5 h-3.5 text-primary" />
        <h3 className="text-xs font-semibold text-foreground font-heading">분석 이력</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">{history.length}건</span>
      </div>
      <div className="max-h-48 overflow-auto divide-y divide-border">
        {history.map((entry) => {
          const date = new Date(entry.created_at);
          return (
            <div
              key={entry.id}
              className="px-3 py-2 flex items-center gap-2 hover:bg-accent/50 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{entry.filename}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  <Clock className="w-3 h-3" />
                  <span>{date.toLocaleDateString('ko-KR')} {date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>•</span>
                  <span className="text-critical">{entry.stats.critical} critical</span>
                  <span className="text-warning">{entry.stats.warning} warn</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => onLoad(entry.log_content, entry.results, entry.stats, entry.filename)}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AnalysisHistory;
