import { Shield, Activity, LogOut, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';

const DashboardHeader = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 animate-pulse-glow">
          <Shield className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold font-heading text-foreground tracking-tight">
            LogMind
          </h1>
          <p className="text-xs text-muted-foreground">미들웨어 장애 분석 및 조치 가이드</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <nav className="flex items-center gap-1 mr-2">
          <Button
            variant={location.pathname === '/' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => navigate('/')}
          >
            <Shield className="w-3 h-3 mr-1" />
            분석
          </Button>
          <Button
            variant={location.pathname === '/splitter' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => navigate('/splitter')}
          >
            <Scissors className="w-3 h-3 mr-1" />
            파일 분할
          </Button>
        </nav>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="w-3.5 h-3.5 text-success" />
          <span>시스템 정상</span>
        </div>
        {user && (
          <div className="flex items-center gap-2 border-l border-border pl-3">
            <span className="text-xs text-muted-foreground truncate max-w-[150px]">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut} className="h-7 px-2">
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
};

export default DashboardHeader;
