import { useState, useCallback } from 'react';
import { Upload, FileText, Loader2, Image, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface LogUploaderProps {
  onLogLoaded: (content: string, filename: string, file?: File) => void;
  onMultiLogLoaded?: (files: File[]) => void;
  onDemoLoad: () => void;
  isAnalyzing: boolean;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB (테스트 한도)

const LogUploader = ({ onLogLoaded, onMultiLogLoaded, onDemoLoad, isAnalyzing }: LogUploaderProps) => {
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

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f => !isImageFile(f));
    const imageFiles = Array.from(files).filter(f => isImageFile(f));

    // Handle image files via OCR (single only)
    if (imageFiles.length > 0) {
      processImageFile(imageFiles[0]);
      return;
    }

    // Multi-file: 2 log files → correlated analysis
    if (fileArray.length >= 2 && onMultiLogLoaded) {
      toast({ title: '다중 로그 감지', description: `${fileArray.length}개 파일을 통합 분석합니다.` });
      onMultiLogLoaded(fileArray.slice(0, 2));
      return;
    }

    // Single file
    if (fileArray.length === 1) {
      const file = fileArray[0];
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: '파일이 너무 큽니다',
          description: '최대 20MB까지 업로드할 수 있습니다. 파일 분할 기능을 이용해 주세요.',
          variant: 'destructive',
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        onLogLoaded(e.target?.result as string, file.name, file);
      };
      reader.readAsText(file);
    }
  }, [onLogLoaded, onMultiLogLoaded, processImageFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  }, [handleFiles]);

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
        .log, .txt 파일 지원 | <Image className="w-3 h-3 inline" /> 이미지 OCR 지원
      </p>
      <p className="text-xs text-primary/70 mt-0.5">
        <Plus className="w-3 h-3 inline" /> 2개 파일 동시 업로드 시 통합 상관분석
      </p>
      <input
        id="log-file-input"
        type="file"
        accept=".log,.txt,.png,.jpg,.jpeg,.gif,.bmp,.webp"
        className="hidden"
        onChange={handleFileInput}
        multiple
      />
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
