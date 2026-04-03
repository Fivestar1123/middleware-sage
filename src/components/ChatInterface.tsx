import { useState } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const mockResponses: Record<string, string> = {
  '메모리': '네, 현재 로그에서 OutOfMemoryError가 2회 발생했습니다.\n\n1. Java heap space 부족 (09:45) - DataProcessor에서 대용량 데이터 처리 시 ArrayList 무한 증가\n2. GC overhead limit exceeded (09:55) - CacheManager eviction 실패\n\n이 두 에러는 메모리 누수와 직접적으로 관련되어 있습니다. Heap 덤프 분석을 권장합니다.',
  '세션': '세션 abnormal closed는 OOM 발생 직후(09:45:13)에 나타났습니다. 메모리 부족으로 SessionManager가 정상 동작하지 못해 발생한 2차 장애입니다. OOM 해결이 선행되어야 합니다.',
  '커넥션': 'DB 커넥션 풀이 45/50으로 포화 임박 상태입니다. WebtoB의 "not closed" 에러와 연관될 수 있으며, 커넥션 반환 로직에 문제가 있을 수 있습니다.',
};

const ChatInterface = () => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '로그 분석이 완료되었습니다. 분석 결과에 대해 궁금한 점이 있으시면 질문해주세요.\n\n예시: "이 에러가 메모리 누수랑 관련 있어?", "세션 끊김 원인이 뭐야?"' },
  ]);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput('');

    setTimeout(() => {
      const key = Object.keys(mockResponses).find(k => userMsg.includes(k));
      const response = key
        ? mockResponses[key]
        : `"${userMsg}"에 대해 분석 중입니다.\n\n현재 로그에서 관련 패턴을 찾고 있습니다. 구체적인 에러 키워드(예: OutOfMemory, abnormal closed)를 포함하여 질문해주시면 더 정확한 답변이 가능합니다.`;
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    }, 800);
  };

  return (
    <div className="bg-card border border-border rounded-lg flex flex-col h-64">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-xs font-semibold text-foreground font-heading">💬 대화형 분석</h3>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-3">
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
      </div>
      <div className="p-2 border-t border-border flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="분석 결과에 대해 질문하세요..."
          className="text-xs h-8 bg-muted border-border"
        />
        <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend}>
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default ChatInterface;
