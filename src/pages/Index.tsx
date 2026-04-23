import { useState, useCallback, useRef, useEffect } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DashboardHeader from '@/components/DashboardHeader';
import StatusCards from '@/components/StatusCards';
import SeverityChart from '@/components/SeverityChart';
import LogUploader from '@/components/LogUploader';
import LogViewer from '@/components/LogViewer';
import AnalysisPanel from '@/components/AnalysisPanel';
import ChatInterface, { type Message } from '@/components/ChatInterface';
import ReportExportButton from '@/components/ReportExportButton';
import AnalysisHistory from '@/components/AnalysisHistory';
import AnalysisProgressBar from '@/components/AnalysisProgressBar';
import { mockLogText, type AnalysisResult } from '@/data/mockLogs';
import { analyzeLog, analyzeLargeLog, analyzeCorrelatedLogs, type AnalysisProgress } from '@/lib/logAnalysisApi';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB (테스트 한도)

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
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const historyKeyRef = useRef(0);
  const splitterProcessed = useRef(false);

  const saveToHistory = useCallback(async (filename: string, content: string, results: AnalysisResult[], analysisStats: Stats) => {
    if (!user) return;
    const { error } = await supabase.from('analysis_history').insert({
      user_id: user.id,
      filename,
      log_content: content.slice(0, 500000),
      results: results as any,
      stats: analysisStats as any,
    });
    if (error) {
      console.error('Failed to save history:', error);
    } else {
      historyKeyRef.current += 1;
    }
  }, [user]);

  const runAnalysis = useCallback(async (
    content: string,
    filename: string,
    file?: File,
    priorContext?: { previousLog?: string; previousResults?: AnalysisResult[] },
  ) => {
    setIsAnalyzing(true);
    setAnalysisProgress(null);
    try {
      const isLargeFile = file && file.size >= LARGE_FILE_THRESHOLD;

      if (isLargeFile) {
        const result = await analyzeLargeLog(file, (p) => setAnalysisProgress(p));
        setAnalysisResults(result.analyses);
        setStats(result.stats);
        toast({ title: '분석 완료', description: `${result.analyses.length}개의 장애 패턴을 발견했습니다. (2단계 분석)` });
        await saveToHistory(filename, content.slice(0, 500000), result.analyses, result.stats);
      } else {
        const result = await analyzeLog(content, priorContext);
        setAnalysisResults(result.analyses);
        setStats(result.stats);
        toast({
          title: priorContext ? '추가 분석 완료' : '분석 완료',
          description: `${result.analyses.length}개의 장애 패턴을 발견했습니다.${priorContext ? ' (1차 분석 컨텍스트 반영)' : ''}`,
        });
        await saveToHistory(filename, content, result.analyses, result.stats);
      }
    } catch (e) {
      setAnalysisProgress({ phase: 'error', percent: 0, message: e instanceof Error ? e.message : '알 수 없는 오류' });
      toast({
        title: 'AI 분석 오류',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [saveToHistory]);

  const runCorrelatedAnalysis = useCallback(async (files: File[]) => {
    if (files.length < 2) return;
    setIsAnalyzing(true);
    setAnalysisProgress(null);
    setHasLog(true);
    setCurrentFilename(`${files[0].name} + ${files[1].name}`);
    setLogContent(`[통합 분석] ${files[0].name} & ${files[1].name}`);
    setAnalysisResults([]);

    try {
      const result = await analyzeCorrelatedLogs(files[0], files[1], (p) => setAnalysisProgress(p));
      setAnalysisResults(result.analyses);
      setStats(result.stats);
      toast({
        title: '통합 분석 완료',
        description: `${result.analyses.length}개의 장애 패턴 발견 (2개 파일 상관분석)`,
      });
      await saveToHistory(
        `${files[0].name} + ${files[1].name}`,
        `[통합 분석]\n파일1: ${files[0].name}\n파일2: ${files[1].name}`,
        result.analyses,
        result.stats,
      );
    } catch (e) {
      setAnalysisProgress({ phase: 'error', percent: 0, message: e instanceof Error ? e.message : '알 수 없는 오류' });
      toast({
        title: '통합 분석 오류',
        description: e instanceof Error ? e.message : '알 수 없는 오류',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [saveToHistory]);

  const handleLogLoaded = useCallback((content: string, filename: string, file?: File) => {
    setLogContent(content);
    setHasLog(true);
    setCurrentFilename(filename);
    setCurrentFile(file || null);
    setAnalysisResults([]);
    runAnalysis(content, filename, file);
  }, [runAnalysis]);

  const handleAppendLogLoaded = useCallback((content: string, filename: string, file?: File) => {
    const previousLog = logContent;
    const previousResults = analysisResults;
    const mergedFilename = currentFilename ? `${currentFilename} + ${filename}` : filename;
    const mergedContent =
      `===== [1차 로그] ${currentFilename || 'previous'} =====\n${previousLog}\n\n` +
      `===== [추가 로그] ${filename} =====\n${content}`;
    setLogContent(mergedContent);
    setCurrentFilename(mergedFilename);
    setCurrentFile(file || null);
    runAnalysis(content, mergedFilename, file, { previousLog, previousResults });
  }, [logContent, analysisResults, currentFilename, runAnalysis]);

  const handleMultiLogLoaded = useCallback((files: File[]) => {
    setCurrentFile(null);
    runCorrelatedAnalysis(files);
  }, [runCorrelatedAnalysis]);

  // Check for chunk from FileSplitter
  useEffect(() => {
    if (splitterProcessed.current) return;
    (async () => {
      const { consumePendingSplitterChunk } = await import('@/lib/splitterTransfer');
      const data = consumePendingSplitterChunk();
      if (data) {
        splitterProcessed.current = true;
        handleLogLoaded(data.content, data.filename);
        return;
      }
      // Backwards-compat: clear any old sessionStorage entries
      const content = sessionStorage.getItem('splitter_log_content');
      const filename = sessionStorage.getItem('splitter_log_filename');
      if (content && filename) {
        splitterProcessed.current = true;
        sessionStorage.removeItem('splitter_log_content');
        sessionStorage.removeItem('splitter_log_filename');
        handleLogLoaded(content, filename);
      }
    })();
  }, [handleLogLoaded]);

  const handleDemoLoad = useCallback(() => {
    setLogContent(mockLogText);
    setHasLog(true);
    setCurrentFilename('demo_log.log');
    setCurrentFile(null);
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
    setCurrentFile(null);
    setAnalysisProgress(null);
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

      <main className="flex-1 p-3 sm:p-4 space-y-3 sm:space-y-4 max-w-[1600px] mx-auto w-full">
        {/* Top: Status + Upload */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3 sm:gap-4">
          <div className="flex-1">
            <StatusCards stats={stats} />
          </div>
          <div className="w-full sm:w-72 sm:shrink-0 space-y-2">
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
              <LogUploader
                onLogLoaded={handleLogLoaded}
                onMultiLogLoaded={handleMultiLogLoaded}
                onDemoLoad={handleDemoLoad}
                isAnalyzing={isAnalyzing}
              />
            )}
            <ReportExportButton
              filename={currentFilename}
              analysisResults={analysisResults}
              stats={stats}
              chatMessages={chatMessages}
              disabled={!hasLog || analysisResults.length === 0}
            />
          </div>
        </div>

        {/* Analysis Progress */}
        {isAnalyzing && analysisProgress && (
          <AnalysisProgressBar progress={analysisProgress} />
        )}

        {/* History */}
        {!hasLog && <AnalysisHistory key={historyKeyRef.current} onLoad={handleLoadHistory} />}

        {/* Charts */}
        {hasLog && <SeverityChart stats={stats} />}

        {/* Main Analysis Area */}
        {hasLog && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ minHeight: '300px' }}>
            <div className="h-[300px] md:h-[420px]">
              <LogViewer logContent={logContent} highlightedLines={highlightedLines} />
            </div>
            <div className="h-[300px] md:h-[420px]">
              <AnalysisPanel
                results={analysisResults}
                onHoverLines={setHighlightedLines}
                isLoading={isAnalyzing}
              />
            </div>
          </div>
        )}

        {/* Chat */}
        {hasLog && !isAnalyzing && analysisResults.length > 0 && (
          <ChatInterface logContent={logContent} analysisResults={analysisResults} onMessagesChange={setChatMessages} />
        )}
      </main>
    </div>
  );
};

export default Index;
