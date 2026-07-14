import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Upload, Download, FileText, Trash2, Eye, Play, Search, History, Clock, Loader2, AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DashboardHeader from '@/components/DashboardHeader';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface SplitHistoryEntry {
  id: string;
  filename: string;
  original_size: number;
  chunk_size_mb: number;
  chunk_count: number;
  file_path: string | null;
  is_zip?: boolean;
  analysis?: CachedChunk[] | null;
  created_at: string;
}
interface CachedChunk {
  name: string;
  size: number;
  analysis: ChunkAnalysis;
}

interface ChunkAnomaly {
  severity: 'critical' | 'high' | 'medium';
  lineNumber: number;
  timestamp: string | null;
  message: string;
  reason: string;
  tier: 1 | 2;
}
interface ChunkAnalysis {
  status: 'pending' | 'analyzing' | 'done' | 'error';
  firstTime?: string | null;
  lastTime?: string | null;
  errorCount?: number;
  warnCount?: number;
  anomalies?: ChunkAnomaly[];
  spikes?: { bucket: string; count: number; avg: number }[];
  error?: string;
}
interface ChunkInfo {
  name: string;
  size: number;
  blob: Blob;
  analysis: ChunkAnalysis;
}

const FileSplitter = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [chunkSizeMB, setChunkSizeMB] = useState(1);
  const [isSplitting, setIsSplitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [selectedChunk, setSelectedChunk] = useState<number | null>(null);
  const [chunkPreview, setChunkPreview] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [splitHistory, setSplitHistory] = useState<SplitHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const zipRef = useRef<JSZip | null>(null);
  const cachedZipBlobRef = useRef<Blob | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resolveUser = useCallback(async () => {
    if (user) return user;

    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error('Failed to resolve user:', error);
      return null;
    }

    return data.user;
  }, [user]);

  const fetchHistory = useCallback(async () => {
    if (authLoading) return;

    setHistoryLoading(true);

    const currentUser = await resolveUser();
    if (!currentUser) {
      setSplitHistory([]);
      setHistoryLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('split_history')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Failed to fetch split history:', error);
    } else {
      setSplitHistory(data as unknown as SplitHistoryEntry[]);
    }

    setHistoryLoading(false);
  }, [authLoading, resolveUser]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const saveHistory = useCallback(async (
    filename: string,
    originalSize: number,
    chunkMb: number,
    count: number,
    filePath: string,
    userId: string,
    isZip: boolean = false,
    analysis: CachedChunk[] | null = null,
  ) => {
    const { error } = await supabase.from('split_history').insert({
      user_id: userId,
      filename,
      original_size: originalSize,
      chunk_size_mb: chunkMb,
      chunk_count: count,
      file_path: filePath || null,
      is_zip: isZip,
      analysis: analysis as unknown as never,
    });

    if (error) {
      console.error('Failed to save split history:', error);
      toast({ title: '이력 저장 실패', description: error.message, variant: 'destructive' });
      return;
    }

    await fetchHistory();
  }, [fetchHistory]);


  const deleteHistory = useCallback(async (entry: SplitHistoryEntry) => {
    if (entry.file_path && user) {
      await supabase.storage.from('split-files').remove([entry.file_path]);
    }
    await supabase.from('split_history').delete().eq('id', entry.id);
    setSplitHistory(prev => prev.filter(h => h.id !== entry.id));
    toast({ title: '삭제 완료' });
  }, [user]);

  const splitFileRef = useRef<((f: File, mb: number) => void) | null>(null);

  const handleResplit = useCallback(async (entry: SplitHistoryEntry) => {
    if (!entry.file_path) {
      toast({ title: '파일 없음', description: '저장된 데이터가 없어 불러올 수 없습니다.', variant: 'destructive' });
      return;
    }

    // Cached (zip) mode: restore chunks + analysis without re-splitting
    if (entry.is_zip && entry.analysis) {
      toast({ title: '캐시에서 복원 중...', description: entry.filename });
      const { data, error } = await supabase.storage.from('split-files').download(entry.file_path);
      if (error || !data) {
        toast({ title: '다운로드 실패', description: error?.message || '알 수 없는 오류', variant: 'destructive' });
        return;
      }
      try {
        // Cache the downloaded zip blob for later re-download without regenerating.
        cachedZipBlobRef.current = data;
        const zip = await JSZip.loadAsync(data);
        const restored: ChunkInfo[] = [];
        // Extract chunks one-by-one and drop them from JSZip to free memory.
        for (const cached of entry.analysis) {
          const zEntry = zip.file(cached.name);
          if (!zEntry) continue;
          const blob = await zEntry.async('blob');
          restored.push({ name: cached.name, size: cached.size ?? blob.size, blob, analysis: cached.analysis });
          zip.remove(cached.name);
        }
        zipRef.current = null;
        // Lightweight placeholder file (no bytes) to avoid duplicating the zip in memory.
        const virtualFile = new File([], entry.filename, { type: 'application/zip' });
        setFile(virtualFile);
        setChunkSizeMB(entry.chunk_size_mb);
        setChunks(restored);
        setProgress(100);
        setPreview('');
        setSelectedChunk(null);
        toast({ title: '복원 완료', description: `${restored.length}개 청크와 분석 결과를 불러왔습니다.` });
      } catch (e) {
        toast({ title: '복원 실패', description: e instanceof Error ? e.message : '알 수 없는 오류', variant: 'destructive' });
      }
      return;
    }

    // Legacy mode: entry stores original file, re-split
    toast({ title: '원본 불러오는 중...', description: entry.filename });
    const { data, error } = await supabase.storage.from('split-files').download(entry.file_path);
    if (error || !data) {
      toast({ title: '다운로드 실패', description: error?.message || '알 수 없는 오류', variant: 'destructive' });
      return;
    }
    const f = new File([data], entry.filename);
    setChunkSizeMB(entry.chunk_size_mb);
    setFile(f);
    setChunks([]);
    setProgress(0);
    setSelectedChunk(null);
    zipRef.current = null;
    const slice = f.slice(0, 50_000);
    const text = await slice.text();
    const lines = text.split('\n').slice(0, 100);
    setPreview(lines.join('\n'));
    splitFileRef.current?.(f, entry.chunk_size_mb);
  }, []);


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

  // Analyze all chunks and return the final list with analysis populated
  const detectAnomalies = useCallback(async (list: ChunkInfo[]): Promise<ChunkInfo[]> => {
    const results: ChunkInfo[] = [...list];
    for (let i = 0; i < results.length; i++) {
      const chunk = results[i];
      setChunks(prev => prev.map((c, idx) => idx === i ? { ...c, analysis: { ...c.analysis, status: 'analyzing' } } : c));
      try {
        const text = await chunk.blob.text();
        const { data, error } = await supabase.functions.invoke('analyze-chunk', { body: { text } });
        if (error || data?.error) throw new Error(error?.message || data?.error || 'analyze-chunk failed');
        const analysis: ChunkAnalysis = {
          status: 'done',
          firstTime: data.firstTime,
          lastTime: data.lastTime,
          errorCount: data.errorCount,
          warnCount: data.warnCount,
          anomalies: data.anomalies,
          spikes: data.spikes,
        };
        results[i] = { ...chunk, analysis };
        setChunks(prev => prev.map((c, idx) => idx === i ? results[i] : c));
      } catch (e) {
        const analysis: ChunkAnalysis = { status: 'error', error: e instanceof Error ? e.message : 'unknown' };
        results[i] = { ...chunk, analysis };
        setChunks(prev => prev.map((c, idx) => idx === i ? results[i] : c));
      }
    }
    return results;
  }, []);



  const splitFile = useCallback(async (targetFile: File, chunkMb: number) => {
    if (!targetFile || authLoading) return;

    setIsSplitting(true);
    setProgress(0);
    setChunks([]);
    setSelectedChunk(null);

    try {
      const chunkSize = chunkMb * 1024 * 1024;
      const totalChunks = Math.ceil(targetFile.size / chunkSize);
      const zip = new JSZip();
      const baseName = targetFile.name.replace(/\.[^.]+$/, '');
      const ext = targetFile.name.includes('.') ? targetFile.name.slice(targetFile.name.lastIndexOf('.')) : '.txt';
      const resultChunks: ChunkInfo[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, targetFile.size);
        const blob = targetFile.slice(start, end);
        const name = `${baseName}_part${String(i + 1).padStart(3, '0')}${ext}`;
        zip.file(name, blob);
        resultChunks.push({ name, size: end - start, blob, analysis: { status: 'pending' } });
        setProgress(Math.round(((i + 1) / totalChunks) * 100));
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }

      zipRef.current = zip;
      setChunks(resultChunks);
      toast({ title: '분할 완료', description: `${resultChunks.length}개 파일로 분할되었습니다. 이상탐지를 시작합니다.` });

      const currentUser = await resolveUser();
      if (!currentUser) {
        toast({ title: '이력 저장 실패', description: '로그인 정보를 확인한 뒤 다시 시도해주세요.', variant: 'destructive' });
        // still run detection locally
        void detectAnomalies(resultChunks);
        return;
      }

      // Run detection, then cache zip + analysis
      const analyzed = await detectAnomalies(resultChunks);

      try {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const storagePath = `${currentUser.id}/${Date.now()}_${baseName}_chunks.zip`;
        const { error: uploadErr } = await supabase.storage.from('split-files').upload(storagePath, zipBlob, {
          contentType: 'application/zip',
        });
        if (uploadErr) {
          console.error('Chunk zip upload failed:', uploadErr);
          await saveHistory(targetFile.name, targetFile.size, chunkMb, resultChunks.length, '', currentUser.id, false, null);
          return;
        }
        const cached: CachedChunk[] = analyzed.map(c => ({ name: c.name, size: c.size, analysis: c.analysis }));
        await saveHistory(targetFile.name, targetFile.size, chunkMb, resultChunks.length, storagePath, currentUser.id, true, cached);
      } catch (e) {
        console.error('Cache save failed:', e);
      }
    } catch (error) {
      console.error('Split failed:', error);
      toast({
        title: '분할 실패',
        description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsSplitting(false);
    }
  }, [authLoading, detectAnomalies, resolveUser, saveHistory]);

  splitFileRef.current = splitFile;


  const handleSplit = useCallback(() => {
    if (file) void splitFile(file, chunkSizeMB);
  }, [file, chunkSizeMB, splitFile]);

  const handleDownloadAll = useCallback(async () => {
    if (!file) return;
    let blob: Blob | null = cachedZipBlobRef.current;
    if (!blob) {
      if (!zipRef.current) return;
      toast({ title: 'ZIP 생성 중...', description: '잠시만 기다려주세요.' });
      blob = await zipRef.current.generateAsync({ type: 'blob' });
    }
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
    try {
      const text = await chunk.blob.text();
      const { setPendingSplitterChunk } = await import('@/lib/splitterTransfer');
      setPendingSplitterChunk(text, chunk.name);
      navigate('/');
    } catch (e) {
      toast({
        title: '청크 로드 실패',
        description: e instanceof Error ? e.message : '청크 크기가 너무 큽니다. 더 작게 분할해 주세요.',
        variant: 'destructive',
      });
      return;
    }
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
                  max={5}
                  step={1}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground">
                  각 파일이 약 {chunkSizeMB}MB씩 분할됩니다 · 예상 {estimatedChunks}개 파일
                </p>
                <p className="text-xs text-warning">
                  ⚠️ 분할 크기는 최대 <strong>5MB</strong>로 제한됩니다 (분석 업로드 한도와 동일)
                </p>
              </CardContent>
            </Card>

            <Button className="w-full" size="lg" onClick={handleSplit} disabled={isSplitting || authLoading}>
              <Scissors className="w-4 h-4 mr-2" />
              {authLoading ? '로그인 확인 중...' : isSplitting ? '분할 중...' : '파일 분할하기'}
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
                      {chunks.map((c, i) => {
                        const a = c.analysis;
                        const topSeverity = a.anomalies?.reduce<'critical' | 'high' | 'medium' | null>((acc, x) => {
                          const order = { critical: 3, high: 2, medium: 1 } as const;
                          if (!acc) return x.severity;
                          return order[x.severity] > order[acc] ? x.severity : acc;
                        }, null);
                        const badgeClass =
                          topSeverity === 'critical' ? 'bg-critical/15 text-critical border-critical/30' :
                          topSeverity === 'high' ? 'bg-destructive/15 text-destructive border-destructive/30' :
                          topSeverity === 'medium' ? 'bg-warning/15 text-warning border-warning/30' :
                          'bg-muted text-muted-foreground border-border';
                        const Icon =
                          topSeverity === 'critical' ? ShieldAlert :
                          topSeverity ? AlertTriangle : ShieldCheck;
                        return (
                        <div
                          key={i}
                          className="flex flex-col gap-1 text-xs px-2 py-2 rounded bg-muted/30 hover:bg-muted/60 transition-colors group"
                        >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-foreground font-mono truncate">{c.name}</span>
                            <span className="text-muted-foreground flex-shrink-0">{formatSize(c.size)}</span>
                            {a.status === 'analyzing' && (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <Loader2 className="w-3 h-3 animate-spin" /> 탐지 중
                              </span>
                            )}
                            {a.status === 'done' && (
                              <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${badgeClass}`}
                                title={topSeverity ? `이상 ${a.anomalies!.length}건 (E:${a.errorCount} W:${a.warnCount})` : '이상 없음'}>
                                <Icon className="w-3 h-3" />
                                {topSeverity ? `이상 ${a.anomalies!.length}` : '정상'}
                              </span>
                            )}
                            {a.status === 'error' && (
                              <span className="text-[10px] text-destructive" title={a.error}>탐지 실패</span>
                            )}
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
                        {a.status === 'done' && (a.firstTime || a.lastTime) && (
                          <div className="flex items-center gap-2 pl-5 text-[10px] text-muted-foreground font-mono">
                            <Clock className="w-3 h-3" />
                            <span>{a.firstTime ?? '—'}</span>
                            <span>→</span>
                            <span>{a.lastTime ?? '—'}</span>
                            {(a.spikes?.length ?? 0) > 0 && (
                              <span className="ml-2 text-critical">급증 {a.spikes!.length}구간</span>
                            )}
                          </div>
                        )}
                        </div>
                        );
                      })}

                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Split History */}
        {!file && (
          <Card>
            <CardHeader className="py-2 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs flex items-center gap-1.5 text-foreground">
                <History className="w-3.5 h-3.5 text-primary" />
                분할 이력
              </CardTitle>
              <span className="text-[10px] text-muted-foreground">{splitHistory.length}건</span>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {historyLoading ? (
                <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> 이력 불러오는 중...
                </div>
              ) : splitHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">분할 이력이 없습니다.</p>
              ) : (
                <ScrollArea className="max-h-48">
                  <div className="divide-y divide-border">
                    {splitHistory.map((entry) => {
                      const date = new Date(entry.created_at);
                      return (
                        <div
                          key={entry.id}
                          className={`flex items-center justify-between py-2 group -mx-2 px-2 rounded transition-colors ${entry.file_path ? 'cursor-pointer hover:bg-accent/50' : ''}`}
                          onClick={() => entry.file_path && handleResplit(entry)}
                          title={entry.file_path ? '클릭하여 다시 불러오기' : ''}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground truncate">{entry.filename}</p>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                              <Clock className="w-3 h-3" />
                              <span>{date.toLocaleDateString('ko-KR')} {date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                              <span>•</span>
                              <span>{(entry.original_size / (1024 * 1024)).toFixed(1)}MB → {entry.chunk_size_mb}MB × {entry.chunk_count}개</span>
                              {entry.is_zip && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">캐시됨</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>

                            {entry.file_path && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={async () => {
                                  const { data, error } = await supabase.storage.from('split-files').download(entry.file_path!);
                                  if (error || !data) {
                                    toast({ title: '다운로드 실패', description: error?.message || '알 수 없는 오류', variant: 'destructive' });
                                    return;
                                  }
                                  const dlName = entry.is_zip
                                    ? `${entry.filename.replace(/\.[^.]+$/, '')}_split.zip`
                                    : entry.filename;
                                  const url = URL.createObjectURL(data);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = dlName;
                                  a.click();
                                  URL.revokeObjectURL(url);
                                  toast({ title: '다운로드 완료' });
                                }}
                                title={entry.is_zip ? '분할 ZIP 다운로드' : '원본 파일 다운로드'}
                              >
                                <Download className="w-3 h-3" />
                              </Button>
                            )}

                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-destructive"
                              onClick={() => deleteHistory(entry)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
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
