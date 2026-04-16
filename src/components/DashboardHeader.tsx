import { Shield, Activity, LogOut, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';

const DashboardHeader = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
            <Activity className="w-3.5 h-3.5 text-success" />
            <span>시스템 정상</span>
          </div>
          {user && (
            <div className="flex items-center gap-2 border-l border-border pl-2 sm:pl-3">
              <span className="text-xs text-muted-foreground truncate max-w-[80px] sm:max-w-[150px] hidden sm:inline">{user.email}</span>
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
