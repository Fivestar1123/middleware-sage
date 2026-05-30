import { Shield, Activity, LogOut, Scissors, AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

const ANOMALY_URL = import.meta.env.VITE_ANOMALY_URL || 'http://192.168.28.128:8003';

interface SystemStatus {
  status: 'normal' | 'warning' | 'critical';
  message: string;
}

const useSystemStatus = () => {
  const [status, setStatus] = useState<SystemStatus>({ status: 'normal', message: '시스템 정상' });

  useEffect(() => {
    const checkStatus = async () => {
      try {
        // JVM Heap 시뮬레이션 데이터 (실제 운영 시 메트릭 API로 교체)
        const mockHeap = Array.from({ length: 10 }, () => Math.random() * 30 + 40);

        const res = await fetch(`${ANOMALY_URL}/detect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metric_name: 'heap_usage',
            values: mockHeap,
            threshold: 80.0,
          }),
        });

        if (!res.ok) throw new Error('이상 탐지 서버 응답 오류');
        const data = await res.json();

        if (data.alert) {
          setStatus({
            status: data.max_score > 0.7 ? 'critical' : 'warning',
            message: data.alert_message,
          });
        } else {
          setStatus({ status: 'normal', message: '시스템 정상' });
        }
      } catch {
        setStatus({ status: 'normal', message: '시스템 정상' });
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 60000); // 1분마다 체크
    return () => clearInterval(interval);
  }, []);

  return status;
};

const DashboardHeader = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const systemStatus = useSystemStatus();

  const statusConfig = {
    normal: {
      icon: <Activity className="w-3.5 h-3.5 text-success" />,
      text: '시스템 정상',
      className: 'text-success',
    },
    warning: {
      icon: <AlertTriangle className="w-3.5 h-3.5 text-warning" />,
      text: '주의',
      className: 'text-warning',
    },
    critical: {
      icon: <AlertTriangle className="w-3.5 h-3.5 text-destructive" />,
      text: '이상 감지',
      className: 'text-destructive',
    },
  };

  const config = statusConfig[systemStatus.status];

  return (
    <header className="border-b border-border bg-card px-4 sm:px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 animate-pulse-glow">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold font-heading text-foreground tracking-tight">
              LogMind
            </h1>
            <p className="text-xs text-muted-foreground hidden sm:block">Intelligent Log Analysis</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <nav className="flex items-center gap-1 mr-1 sm:mr-2">
            <Button
              variant={location.pathname === '/' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs px-2 sm:px-3"
              onClick={() => navigate('/')}
            >
              <Shield className="w-3 h-3 sm:mr-1" />
              <span className="hidden sm:inline">분석</span>
            </Button>
            <Button
              variant={location.pathname === '/splitter' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs px-2 sm:px-3"
              onClick={() => navigate('/splitter')}
            >
              <Scissors className="w-3 h-3 sm:mr-1" />
              <span className="hidden sm:inline">파일 분할</span>
            </Button>
          </nav>
          <div
            className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground cursor-pointer"
            title={systemStatus.message}
          >
            {config.icon}
            <span className={config.className}>{config.text}</span>
          </div>
          {user && (
            <div className="flex items-center gap-2 border-l border-border pl-2 sm:pl-3">
              <span className="text-xs text-muted-foreground truncate max-w-[80px] sm:max-w-[150px] hidden sm:inline">
                {user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={signOut} className="h-7 px-2">
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
