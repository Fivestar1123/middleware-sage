import { useState, useCallback } from 'react';
import { Upload, FileText, Loader2, Image, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface LogUploaderProps {
  onLogLoaded: (content: string, filename: string, file?: File) => void;
  onMultiLogLoaded?: (files: File[]) => void;
  onDemoLoad: () => void;
  isAnalyzing: boolean;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const LogUploader = ({ onLogLoaded, onMultiLogLoaded, onDemoLoad, isAnalyzing }: LogUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressText, setProgressText] = useState('');

  const isImageFile = (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext) || file.type.startsWith('image/');
  };

  const processImageFile = useCallback(async (file: File) => {
    setIsOcrProcessing(true);
    setUploadProgress(0);
    setProgressText('이미지 업로드 중...');
    try {
      const formData = new FormData();
      formData.append('file', file);

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ocr-log`;
      const text = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Authorization', `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setUploadProgress(percent);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const res = JSON.parse(xhr.responseText);
              if (!res.text || res.text.trim().length === 0) {
                reject(new Error('이미지에서 로그 텍스트를 추출할 수 없습니다.'));
              } else {
                resolve(res.text);
              }
            } catch {
              reject(new Error('OCR 응답 처리 실패'));
            }
          } else {
            let errMsg = `OCR failed (${xhr.status})`;
            try {
              const err = JSON.parse(xhr.responseText);
              errMsg = err.error || errMsg;
            } catch {}
            reject(new Error(errMsg));
          }
        };

        xhr.onerror = () => reject(new Error('이미지 업로드 중 네트워크 오류'));
        xhr.send(formData);
      });

      setProgressText('로그 텍스트 추출 중...');
      setUploadProgress(100);
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
      setUploadProgress(0);
      setProgressText('');
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
          description: '최대 5MB까지 업로드할 수 있습니다. 파일 분할 기능을 이용해 주세요.',
          variant: 'destructive',
        });
        return;
      }
      setProgressText('파일 읽는 중...');
      setUploadProgress(0);
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      reader.onload = (e) => {
        setUploadProgress(100);
        onLogLoaded(e.target?.result as string, file.name, file);
        setUploadProgress(0);
        setProgressText('');
      };
      reader.onerror = () => {
        setUploadProgress(0);
        setProgressText('');
        toast({ title: '파일 읽기 오류', description: '파일을 읽는 중 문제가 발생했습니다.', variant: 'destructive' });
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

  if (isAnalyzing || isOcrProcessing || uploadProgress > 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-primary">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>
            {isOcrProcessing
              ? progressText || '이미지에서 로그 추출 중...'
              : uploadProgress > 0
                ? progressText || '파일 읽는 중...'
                : 'AI 분석 중...'}
          </span>
        </div>
        {(isOcrProcessing || uploadProgress > 0) && (
          <Progress value={uploadProgress} className="h-1.5" />
        )}
        <p className="text-[10px] text-muted-foreground text-right">{uploadProgress}%</p>
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
      <p className="text-xs text-warning mt-0.5">
        ⚠️ 최대 <strong>5MB</strong>까지 업로드 가능 (초과 시 파일 분할 이용)
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
