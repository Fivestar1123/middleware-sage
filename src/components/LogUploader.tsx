import { useState, useCallback } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LogUploaderProps {
  onLogLoaded: (content: string, filename: string) => void;
  onDemoLoad: () => void;
  isAnalyzing: boolean;
}

const LogUploader = ({ onLogLoaded, onDemoLoad, isAnalyzing }: LogUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      onLogLoaded(e.target?.result as string, file.name);
    };
    reader.readAsText(file);
  }, [onLogLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  if (isAnalyzing) {
    return (
      <div className="flex items-center gap-2 text-xs text-primary">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>AI 분석 중...</span>
      </div>
    );
  }

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
        isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'
      }`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => document.getElementById('log-file-input')?.click()}
    >
      <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
      <p className="text-sm text-foreground font-medium">로그 파일을 드래그하거나 클릭하여 업로드</p>
      <p className="text-xs text-muted-foreground mt-1">.log, .txt, .hprof, .phd, .dmp 파일 지원</p>
      <input id="log-file-input" type="file" accept=".log,.txt,.hprof,.phd,.dmp" className="hidden" onChange={handleFileInput} />
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={(e) => { e.stopPropagation(); onDemoLoad(); }}
      >
        <FileText className="w-3.5 h-3.5 mr-1" />
        데모 로그 불러오기
      </Button>
    </div>
  );
};

export default LogUploader;
