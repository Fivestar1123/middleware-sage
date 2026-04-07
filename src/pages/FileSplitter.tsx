import { useState, useCallback, useRef } from 'react';
import { Scissors, Upload, Download, FileText, Trash2, Eye } from 'lucide-react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import DashboardHeader from '@/components/DashboardHeader';
import { toast } from '@/hooks/use-toast';

const FileSplitter = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [chunkSizeMB, setChunkSizeMB] = useState(1);
  const [isSplitting, setIsSplitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chunks, setChunks] = useState<{ name: string; size: number }[]>([]);
  const zipRef = useRef<JSZip | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setChunks([]);
    setProgress(0);
    zipRef.current = null;

    // Read first 100 lines for preview
    const slice = f.slice(0, 50_000);
    const text = await slice.text();
    const lines = text.split('\n').slice(0, 100);
    setPreview(lines.join('\n'));
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleSplit = useCallback(async () => {
    if (!file) return;
    setIsSplitting(true);
    setProgress(0);
    setChunks([]);

    const chunkSize = chunkSizeMB * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / chunkSize);
    const zip = new JSZip();
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.txt';
    const resultChunks: { name: string; size: number }[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const blob = file.slice(start, end);
      const name = `${baseName}_part${String(i + 1).padStart(3, '0')}${ext}`;
      zip.file(name, blob);
      resultChunks.push({ name, size: end - start });
      setProgress(Math.round(((i + 1) / totalChunks) * 100));
      // Yield to UI
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }

    zipRef.current = zip;
    setChunks(resultChunks);
    setIsSplitting(false);
    toast({ title: '분할 완료', description: `${resultChunks.length}개 파일로 분할되었습니다.` });
  }, [file, chunkSizeMB]);

  const handleDownload = useCallback(async () => {
    if (!zipRef.current || !file) return;
    toast({ title: 'ZIP 생성 중...', description: '잠시만 기다려주세요.' });
    const blob = await zipRef.current.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.name.replace(/\.[^.]+$/, '')}_split.zip`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: '다운로드 완료', description: 'ZIP 파일이 다운로드되었습니다.' });
  }, [file]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPreview('');
    setChunks([]);
    setProgress(0);
    zipRef.current = null;
  }, []);

  const estimatedChunks = file ? Math.ceil(file.size / (chunkSizeMB * 1024 * 1024)) : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <DashboardHeader />
      <main className="flex-1 p-4 max-w-3xl mx-auto w-full space-y-4">
        <div className="text-center space-y-1">
          <h2 className="text-2xl font-bold font-heading text-foreground flex items-center justify-center gap-2">
            <Scissors className="w-6 h-6 text-primary" />
            로그 파일 분할기
          </h2>
          <p className="text-sm text-muted-foreground">대용량 로그 파일을 원하는 크기로 분할하여 ZIP으로 다운로드</p>
        </div>

        {/* Upload Area */}
        {!file ? (
          <Card
            className="border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
              <Upload className="w-10 h-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">클릭하거나 드래그하여 텍스트 파일 업로드</p>
              <p className="text-xs text-muted-foreground/60">.log, .txt 파일 지원</p>
              <input
                ref={inputRef}
                type="file"
                accept=".log,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* File Info */}
            <Card>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">{file.name}</span>
                  <span className="text-xs text-muted-foreground">({formatSize(file.size)})</span>
                </div>
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  초기화
                </Button>
              </CardContent>
            </Card>

            {/* Preview */}
            {preview && (
              <Card>
                <CardHeader className="py-2 px-4">
                  <CardTitle className="text-xs flex items-center gap-1.5 text-muted-foreground">
                    <Eye className="w-3.5 h-3.5" />
                    파일 미리보기 (처음 100줄)
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <ScrollArea className="h-40 rounded border border-border bg-muted/30 p-2">
                    <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono">{preview}</pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Chunk Size Setting */}
            <Card>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">분할 크기 설정</span>
                  <span className="text-lg font-bold text-primary">{chunkSizeMB} MB</span>
                </div>
                <Slider
                  value={[chunkSizeMB]}
                  onValueChange={([v]) => setChunkSizeMB(v)}
                  min={1}
                  max={50}
                  step={1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  각 파일이 약 {chunkSizeMB}MB씩 분할됩니다 · 예상 {estimatedChunks}개 파일
                </p>
              </CardContent>
            </Card>

            {/* Split Button */}
            <Button
              className="w-full"
              size="lg"
              onClick={handleSplit}
              disabled={isSplitting}
            >
              <Scissors className="w-4 h-4 mr-2" />
              {isSplitting ? '분할 중...' : '파일 분할하기'}
            </Button>

            {/* Progress */}
            {(isSplitting || progress > 0) && (
              <Progress value={progress} className="w-full" />
            )}

            {/* Results */}
            {chunks.length > 0 && (
              <Card>
                <CardHeader className="py-2 px-4">
                  <CardTitle className="text-sm text-foreground">
                    분할 완료: {chunks.length}개 파일
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-2">
                  <ScrollArea className="h-48">
                    <div className="space-y-1">
                      {chunks.map((c, i) => (
                        <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-muted/30">
                          <span className="text-foreground font-mono">{c.name}</span>
                          <span className="text-muted-foreground">{formatSize(c.size)}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                  <Button className="w-full" onClick={handleDownload}>
                    <Download className="w-4 h-4 mr-2" />
                    ZIP으로 다운로드
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default FileSplitter;
