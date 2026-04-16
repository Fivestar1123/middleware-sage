import { useState, useCallback } from 'react';
import { Upload, FileText, Loader2, Image } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface LogUploaderProps {
  onLogLoaded: (content: string, filename: string, file?: File) => void;
  onDemoLoad: () => void;
  isAnalyzing: boolean;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;

const LogUploader = ({ onLogLoaded, onDemoLoad, isAnalyzing }: LogUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);

  const isImageFile = (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext) || file.type.startsWith('image/');
  };

  const processImageFile = useCallback(async (file: File) => {
    setIsOcrProcessing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ocr-log`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `OCR failed (${resp.status})`);
      }

      const { text } = await resp.json();
      if (!text || text.trim().length === 0) {
        throw new Error('이미지에서 로그 텍스트를 추출할 수 없습니다.');
      }

      toast({ title: 'OCR 완료', description: '이미지에서 로그 텍스트를 추출했습니다.' });
      onLogLoaded(text, file.name);
    } catch (e) {
      toast({
        title: 'OCR 오류',
        description: e instanceof Error ? e.message : '이미지 처리 실패',
        variant: 'destructive',
      });
    } finally {
      setIsOcrProcessing(false);
    }
  }, [onLogLoaded]);

  const handleFile = useCallback((file: File) => {
    if (isImageFile(file)) {
      processImageFile(file);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      const previewSlice = file.slice(0, 200 * 1024);
      const reader = new FileReader();
      reader.onload = (e) => {
        onLogLoaded(e.target?.result as string, file.name, file);
      };
      reader.readAsText(previewSlice);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      onLogLoaded(e.target?.result as string, file.name, file);
    };
    reader.readAsText(file);
  }, [onLogLoaded, processImageFile]);

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

  if (isAnalyzing || isOcrProcessing) {
    return (
      <div className="flex items-center gap-2 text-xs text-primary">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>{isOcrProcessing ? '이미지에서 로그 추출 중...' : 'AI 분석 중...'}</span>
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
      <p className="text-xs text-muted-foreground mt-1">
        .log, .txt 파일 지원 | <Image className="w-3 h-3 inline" /> 이미지(PNG, JPG) OCR 지원
      </p>
      <input id="log-file-input" type="file" accept=".log,.txt,.png,.jpg,.jpeg,.gif,.bmp,.webp" className="hidden" onChange={handleFileInput} />
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
