import { useState, useCallback } from 'react';
import { FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DashboardHeader from '@/components/DashboardHeader';
import StatusCards from '@/components/StatusCards';
import SeverityChart from '@/components/SeverityChart';
import LogUploader from '@/components/LogUploader';
import LogViewer from '@/components/LogViewer';
import AnalysisPanel from '@/components/AnalysisPanel';
import ChatInterface from '@/components/ChatInterface';
import { mockLogText, mockAnalysisResults } from '@/data/mockLogs';

const Index = () => {
  const [logContent, setLogContent] = useState(mockLogText);
  const [hasLog, setHasLog] = useState(true);
  const [highlightedLines, setHighlightedLines] = useState<number[]>([]);

  const handleLogLoaded = useCallback((content: string, _filename: string) => {
    setLogContent(content);
    setHasLog(true);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <DashboardHeader />

      <main className="flex-1 p-4 space-y-4 max-w-[1600px] mx-auto w-full">
        {/* Top: Status + Upload */}
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <StatusCards />
          </div>
          <div className="w-72 shrink-0">
            <LogUploader onLogLoaded={handleLogLoaded} hasLog={hasLog} />
            <Button variant="outline" size="sm" className="w-full mt-2">
              <FileDown className="w-3.5 h-3.5 mr-1" />
              보고서 생성 (Markdown)
            </Button>
          </div>
        </div>

        {/* Charts */}
        <SeverityChart />

        {/* Main Analysis Area */}
        {hasLog && (
          <div className="grid grid-cols-2 gap-3" style={{ height: '420px' }}>
            <LogViewer logContent={logContent} highlightedLines={highlightedLines} />
            <AnalysisPanel results={mockAnalysisResults} onHoverLines={setHighlightedLines} />
          </div>
        )}

        {/* Chat */}
        {hasLog && <ChatInterface />}
      </main>
    </div>
  );
};

export default Index;
