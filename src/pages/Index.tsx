import { useState, useCallback, useRef } from 'react';
import { FileDown, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DashboardHeader from '@/components/DashboardHeader';
import StatusCards from '@/components/StatusCards';
import SeverityChart from '@/components/SeverityChart';
import LogUploader from '@/components/LogUploader';
import LogViewer from '@/components/LogViewer';
import AnalysisPanel from '@/components/AnalysisPanel';
import ChatInterface from '@/components/ChatInterface';
import AnalysisHistory from '@/components/AnalysisHistory';
import { mockLogText, type AnalysisResult } from '@/data/mockLogs';
import { analyzeLog } from '@/lib/logAnalysisApi';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const generateMarkdownReport = (results: AnalysisResult[], stats: { critical: number; warning: number; info: number; totalLines: number }) => {
  const now = new Date().toLocaleString('ko-KR');
  let md = `# 🛡️ Middleware AI Guard - 장애 분석 보고서\n\n`;
  md += `**생성일시:** ${now}\n\n`;
  md += `---\n\n## 📊 요약\n\n`;
  md += `| 구분 | 건수 |\n|------|------|\n`;
  md += `| 🔴 Critical | ${stats.critical} |\n`;
  md += `| 🟡 Warning | ${stats.warning} |\n`;
  md += `| 🔵 Info | ${stats.info} |\n`;
  md += `| 총 라인 수 | ${stats.totalLines} |\n\n`;
  md += `---\n\n## 🔍 상세 분석 결과\n\n`;
  results.forEach((r, i) => {
    const icon = r.severity === 'critical' ? '🔴' : r.severity === 'warning' ? '🟡' : '🔵';
    md += `### ${i + 1}. ${icon} [${r.severity.toUpperCase()}] ${r.title}\n\n`;
    md += `**장애 원인 추정:**\n${r.cause}\n\n`;
    md += `**권장 조치 가이드:**\n\`\`\`\n${r.recommendation}\n\`\`\`\n\n`;
    md += `**예상 영향 범위:**\n${r.impact}\n\n`;
    md += `**관련 라인:** ${r.relatedLines.join(', ')}\n\n---\n\n`;
  });
  return md;
};

interface Stats {
  critical: number;
  warning: number;
  info: number;
  totalLines: number;
}

const Index = () => {
  const { user } = useAuth();
  const [logContent, setLogContent] = useState('');
  const [hasLog, setHasLog] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [stats, setStats] = useState<Stats>({ critical: 0, warning: 0, info: 0, totalLines: 0 });
  const [highlightedLines, setHighlightedLines] = useState<number[]>([]);
  const [currentFilename, setCurrentFilename] = useState('');
  const historyKeyRef = useRef(0);

  const saveToHistory = useCallback(async (filename: string, content: string, results: AnalysisResult[], analysisStats: Stats) => {
    if (!user) return;
    const { error } = await supabase.from('analysis_history').insert({
      user_id: user.id,
      filename,
      log_content: content,
      results: results as any,
      stats: analysisStats as any,
    });
    if (error) {
      console.error('Failed to save history:', error);
    } else {
      historyKeyRef.current += 1;
    }
  }, [user]);

  const runAnalysis = useCallback(async (content: string, filename: string) => {
    setIsAnalyzing(true);
    try {
      const result = await analyzeLog(content);
      setAnalysisResults(result.analyses);
      setStats(result.stats);
      toast({ title: '분석 완료', description: `${result.analyses.length}개의 장애 패턴을 발견했습니다.` });
      await saveToHistory(filename, content, result.analyses, result.stats);
    } catch (e) {
      toast({
        title: 'AI 분석 오류',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [saveToHistory]);

  const handleLogLoaded = useCallback((content: string, filename: string) => {
    setLogContent(content);
    setHasLog(true);
    setCurrentFilename(filename);
    setAnalysisResults([]);
    runAnalysis(content, filename);
  }, [runAnalysis]);

  const handleDemoLoad = useCallback(() => {
    setLogContent(mockLogText);
    setHasLog(true);
    setCurrentFilename('demo_log.log');
    setAnalysisResults([]);
    runAnalysis(mockLogText, 'demo_log.log');
  }, [runAnalysis]);

  const handleReset = useCallback(() => {
    setLogContent('');
    setHasLog(false);
    setAnalysisResults([]);
    setStats({ critical: 0, warning: 0, info: 0, totalLines: 0 });
    setHighlightedLines([]);
    setCurrentFilename('');
  }, []);

  const handleLoadHistory = useCallback((content: string, results: AnalysisResult[], historyStats: Stats, filename: string) => {
    setLogContent(content);
    setHasLog(true);
    setAnalysisResults(results);
    setStats(historyStats);
    setCurrentFilename(filename);
    setHighlightedLines([]);
    toast({ title: '이력 불러오기', description: `${filename} 분석 결과를 불러왔습니다.` });
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
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={!hasLog || analysisResults.length === 0}
              onClick={() => {
                const md = generateMarkdownReport(analysisResults, stats);
                const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `장애분석보고서_${new Date().toISOString().slice(0, 10)}.md`;
                a.click();
                URL.revokeObjectURL(url);
                toast({ title: '보고서 다운로드', description: 'Markdown 보고서가 다운로드되었습니다.' });
              }}
            >
              <FileDown className="w-3.5 h-3.5 mr-1" />
              보고서 생성 (Markdown)
            </Button>
          </div>
        </div>

        {/* History */}
        {!hasLog && <AnalysisHistory key={historyKeyRef.current} onLoad={handleLoadHistory} />}

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
