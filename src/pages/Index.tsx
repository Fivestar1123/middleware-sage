import { useState, useCallback } from 'react';
import { FileDown, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DashboardHeader from '@/components/DashboardHeader';
import StatusCards from '@/components/StatusCards';
import SeverityChart from '@/components/SeverityChart';
import LogUploader from '@/components/LogUploader';
import LogViewer from '@/components/LogViewer';
import AnalysisPanel from '@/components/AnalysisPanel';
import ChatInterface from '@/components/ChatInterface';
import { mockLogText, type AnalysisResult } from '@/data/mockLogs';
import { analyzeLog } from '@/lib/logAnalysisApi';
import { toast } from '@/hooks/use-toast';

interface Stats {
  critical: number;
  warning: number;
  info: number;
  totalLines: number;
}

const Index = () => {
  const [logContent, setLogContent] = useState('');
  const [hasLog, setHasLog] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [stats, setStats] = useState<Stats>({ critical: 0, warning: 0, info: 0, totalLines: 0 });
  const [highlightedLines, setHighlightedLines] = useState<number[]>([]);

  const runAnalysis = useCallback(async (content: string) => {
    setIsAnalyzing(true);
    try {
      const result = await analyzeLog(content);
      setAnalysisResults(result.analyses);
      setStats(result.stats);
      toast({ title: '분석 완료', description: `${result.analyses.length}개의 장애 패턴을 발견했습니다.` });
    } catch (e) {
      toast({
        title: 'AI 분석 오류',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleLogLoaded = useCallback((content: string, _filename: string) => {
    setLogContent(content);
    setHasLog(true);
    setAnalysisResults([]);
    runAnalysis(content);
  }, [runAnalysis]);

  const handleDemoLoad = useCallback(() => {
    setLogContent(mockLogText);
    setHasLog(true);
    setAnalysisResults([]);
    runAnalysis(mockLogText);
  }, [runAnalysis]);

  const handleReset = useCallback(() => {
    setLogContent('');
    setHasLog(false);
    setAnalysisResults([]);
    setStats({ critical: 0, warning: 0, info: 0, totalLines: 0 });
    setHighlightedLines([]);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <DashboardHeader />

      <main className="flex-1 p-4 space-y-4 max-w-[1600px] mx-auto w-full">
        {/* Top: Status + Upload */}
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <StatusCards stats={stats} />
          </div>
          <div className="w-72 shrink-0 space-y-2">
            {hasLog ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-success flex-1">
                  {isAnalyzing ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /><span className="text-primary">AI 분석 중...</span></>
                  ) : (
                    <><span>✅ 분석 완료</span></>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={handleReset}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  새 로그
                </Button>
              </div>
            ) : (
              <LogUploader onLogLoaded={handleLogLoaded} onDemoLoad={handleDemoLoad} isAnalyzing={isAnalyzing} />
            )}
            <Button variant="outline" size="sm" className="w-full" disabled={!hasLog || analysisResults.length === 0}>
              <FileDown className="w-3.5 h-3.5 mr-1" />
              보고서 생성 (Markdown)
            </Button>
          </div>
        </div>

        {/* Charts */}
        {hasLog && <SeverityChart stats={stats} />}

        {/* Main Analysis Area */}
        {hasLog && (
          <div className="grid grid-cols-2 gap-3" style={{ height: '420px' }}>
            <LogViewer logContent={logContent} highlightedLines={highlightedLines} />
            <AnalysisPanel
              results={analysisResults}
              onHoverLines={setHighlightedLines}
              isLoading={isAnalyzing}
            />
          </div>
        )}

        {/* Chat */}
        {hasLog && !isAnalyzing && analysisResults.length > 0 && (
          <ChatInterface logContent={logContent} />
        )}
      </main>
    </div>
  );
};

export default Index;
