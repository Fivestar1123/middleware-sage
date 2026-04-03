import { Shield, Activity } from 'lucide-react';

const DashboardHeader = () => {
  return (
    <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 animate-pulse-glow">
          <Shield className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold font-heading text-foreground tracking-tight">
            Middleware AI Guard
          </h1>
          <p className="text-xs text-muted-foreground">미들웨어 장애 분석 및 조치 가이드</p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="w-3.5 h-3.5 text-success" />
        <span>시스템 정상</span>
      </div>
    </header>
  );
};

export default DashboardHeader;
