import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Upload, Download, FileText, Trash2, Eye, Play, Search } from 'lucide-react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DashboardHeader from '@/components/DashboardHeader';
import { toast } from '@/hooks/use-toast';

interface ChunkInfo {
  name: string;
  size: number;
  blob: Blob;
}

const FileSplitter = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [chunkSizeMB, setChunkSizeMB] = useState(1);
  const [isSplitting, setIsSplitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [selectedChunk, setSelectedChunk] = useState<number | null>(null);
  const [chunkPreview, setChunkPreview] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
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
    setSelectedChunk(null);
    zipRef.current = null;

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
    setSelectedChunk(null);

    const chunkSize = chunkSizeMB * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / chunkSize);
    const zip = new JSZip();
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '.txt';
    const resultChunks: ChunkInfo[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const blob = file.slice(start, end);
      const name = `${baseName}_part${String(i + 1).padStart(3, '0')}${ext}`;
      zip.file(name, blob);
      resultChunks.push({ name, size: end - start, blob });
      setProgress(Math.round(((i + 1) / totalChunks) * 100));
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }

    zipRef.current = zip;
    setChunks(resultChunks);
    setIsSplitting(false);
    toast({ title: '분할 완료', description: `${resultChunks.length}개 파일로 분할되었습니다.` });
  }, [file, chunkSizeMB]);

  const handleDownloadAll = useCallback(async () => {
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

  const handleChunkPreview = useCallback(async (index: number) => {
    const chunk = chunks[index];
    if (!chunk) return;
    setSelectedChunk(index);
    const text = await chunk.blob.text();
    const lines = text.split('\n').slice(0, 50);
    setChunkPreview(lines.join('\n'));
    setIsPreviewOpen(true);
  }, [chunks]);

  const handleChunkDownload = useCallback((index: number) => {
    const chunk = chunks[index];
    if (!chunk) return;
    const url = URL.createObjectURL(chunk.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = chunk.name;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: '다운로드 완료', description: `${chunk.name} 파일이 다운로드되었습니다.` });
  }, [chunks]);

  const handleChunkAnalyze = useCallback(async (index: number) => {
    const chunk = chunks[index];
    if (!chunk) return;
    const text = await chunk.blob.text();
    // Store in sessionStorage and navigate to analysis page
    sessionStorage.setItem('splitter_log_content', text);
    sessionStorage.setItem('splitter_log_filename', chunk.name);
    navigate('/');
    toast({ title: '분석 페이지로 이동', description: `${chunk.name} 파일을 분석합니다.` });
  }, [chunks, navigate]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPreview('');
    setChunks([]);
    setProgress(0);
    setSelectedChunk(null);
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

            <Button className="w-full" size="lg" onClick={handleSplit} disabled={isSplitting}>
              <Scissors className="w-4 h-4 mr-2" />
              {isSplitting ? '분할 중...' : '파일 분할하기'}
            </Button>

            {(isSplitting || progress > 0) && <Progress value={progress} className="w-full" />}

            {chunks.length > 0 && (
              <Card>
                <CardHeader className="py-2 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm text-foreground">
                    분할 완료: {chunks.length}개 파일
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={handleDownloadAll}>
                    <Download className="w-3.5 h-3.5 mr-1" />
                    전체 ZIP 다운로드
                  </Button>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <ScrollArea className="h-64">
                    <div className="space-y-1">
                      {chunks.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-xs px-2 py-2 rounded bg-muted/30 hover:bg-muted/60 transition-colors group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-foreground font-mono truncate">{c.name}</span>
                            <span className="text-muted-foreground flex-shrink-0">{formatSize(c.size)}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              title="미리보기"
                              onClick={() => handleChunkPreview(i)}
                            >
                              <Search className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              title="다운로드"
                              onClick={() => handleChunkDownload(i)}
                            >
                              <Download className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              title="분석하기"
                              onClick={() => handleChunkAnalyze(i)}
                            >
                              <Play className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>

      {/* Chunk Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Eye className="w-4 h-4 text-primary" />
              {selectedChunk !== null && chunks[selectedChunk]?.name} — 미리보기 (처음 50줄)
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-[50vh] rounded border border-border bg-muted/30 p-3">
            <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono">{chunkPreview}</pre>
          </ScrollArea>
          <div className="flex gap-2 justify-end">
            {selectedChunk !== null && (
              <>
                <Button variant="outline" size="sm" onClick={() => { handleChunkDownload(selectedChunk); }}>
                  <Download className="w-3.5 h-3.5 mr-1" />
                  다운로드
                </Button>
                <Button size="sm" onClick={() => { handleChunkAnalyze(selectedChunk); }}>
                  <Play className="w-3.5 h-3.5 mr-1" />
                  분석하기
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FileSplitter;
