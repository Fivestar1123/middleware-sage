import { useState } from 'react';
import { FileDown, FileText, File } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { generatePdfReport, generateDocxReport } from '@/lib/reportGenerator';
import { toast } from '@/hooks/use-toast';
import type { AnalysisResult } from '@/data/mockLogs';

interface ReportExportButtonProps {
  filename: string;
  analysisResults: AnalysisResult[];
  stats: { critical: number; warning: number; info: number; totalLines: number };
  chatMessages: { role: 'user' | 'assistant'; content: string }[];
  disabled?: boolean;
}

const ReportExportButton = ({ filename, analysisResults, stats, chatMessages, disabled }: ReportExportButtonProps) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleExport = async (format: 'pdf' | 'docx') => {
    setIsGenerating(true);
    try {
      const data = { filename, analysisResults, stats, chatMessages };
      if (format === 'pdf') {
        await generatePdfReport(data);
      } else {
        await generateDocxReport(data);
      }
      toast({ title: '보고서 다운로드 완료', description: `${format.toUpperCase()} 보고서가 다운로드되었습니다.` });
    } catch (e) {
      toast({ title: '보고서 생성 오류', description: e instanceof Error ? e.message : '알 수 없는 오류', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full" disabled={disabled || isGenerating}>
          <FileDown className="w-3.5 h-3.5 mr-1" />
          {isGenerating ? '생성 중...' : '보고서 내보내기'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('pdf')}>
          <File className="w-3.5 h-3.5 mr-2 text-red-500" />
          PDF로 다운로드
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('docx')}>
          <FileText className="w-3.5 h-3.5 mr-2 text-blue-500" />
          DOCX로 다운로드
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ReportExportButton;
