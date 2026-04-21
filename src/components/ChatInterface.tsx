import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { streamChatLog } from '@/lib/logAnalysisApi';
import { toast } from '@/hooks/use-toast';
import type { AnalysisResult } from '@/data/mockLogs';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatInterfaceProps {
  logContent: string;
  analysisResults?: AnalysisResult[];
  onMessagesChange?: (messages: Message[]) => void;
}

export type { Message };

const formatAnalysisContext = (results: AnalysisResult[]): string => {
  if (!results || results.length === 0) return '';
  const lines = results.map((r, i) =>
    `[${i + 1}] (${r.severity.toUpperCase()}) ${r.title}\n` +
    `  - 원인: ${r.cause.replace(/\\n/g, ' ').slice(0, 200)}\n` +
    `  - 권장조치: ${r.recommendation.replace(/\\n/g, ' ').slice(0, 200)}\n` +
    `  - 영향: ${r.impact.replace(/\\n/g, ' ').slice(0, 150)}\n` +
    `  - 관련 라인: ${r.relatedLines.join(', ')}`
  );
  return `===== 사전 AI 분석 결과 (${results.length}건) =====\n${lines.join('\n\n')}\n===== 분석 결과 끝 =====\n\n`;
};

const ChatInterface = ({ logContent, analysisResults, onMessagesChange }: ChatInterfaceProps) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '로그 분석이 완료되었습니다. 분석 결과에 대해 궁금한 점이 있으시면 질문해주세요.\n\n예시: "이 에러가 메모리 누수랑 관련 있어?", "세션 끊김 원인이 뭐야?"' },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    const userMessage: Message = { role: 'user', content: userMsg };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    let assistantSoFar = '';
    const analysisContext = formatAnalysisContext(analysisResults || []);
    const fullContext = analysisContext + (logContent || '');

    try {
      await streamChatLog({
        messages: [...messages.filter(m => m.role !== 'assistant' || messages.indexOf(m) !== 0), userMessage],
        logContext: fullContext,
        onDelta: (chunk) => {
          assistantSoFar += chunk;
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && prev.length > 1 && prev[prev.length - 2]?.content === userMsg) {
              return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
            }
            return [...prev, { role: 'assistant', content: assistantSoFar }];
          });
        },
        onDone: () => setIsLoading(false),
      });
    } catch (e) {
      setIsLoading(false);
      toast({
        title: 'AI 채팅 오류',
        description: e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg flex flex-col h-64">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground font-heading">💬 대화형 분석</h3>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
            )}
            <div className={`max-w-[80%] text-xs leading-relaxed rounded-lg px-3 py-2 whitespace-pre-wrap ${
              msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
            }`}>
              {msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center shrink-0">
                <User className="w-3.5 h-3.5 text-secondary-foreground" />
              </div>
            )}
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
            </div>
            <div className="bg-muted text-muted-foreground text-xs rounded-lg px-3 py-2">분석 중...</div>
          </div>
        )}
      </div>
      <div className="p-2 border-t border-border flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="분석 결과에 대해 질문하세요..."
          className="text-xs h-8 bg-muted border-border"
          disabled={isLoading}
        />
        <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend} disabled={isLoading}>
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default ChatInterface;
