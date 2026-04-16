import { Progress } from '@/components/ui/progress';
import { Loader2, CheckCircle2, AlertCircle, Filter, Brain, Search, GitCompareArrows } from 'lucide-react';
import type { AnalysisProgress } from '@/lib/logAnalysisApi';

interface AnalysisProgressBarProps {
  progress: AnalysisProgress | null;
}

const phaseConfig = {
  filtering: { icon: Filter, label: '전처리', color: 'text-blue-400' },
  correlating: { icon: GitCompareArrows, label: '상관분석', color: 'text-cyan-400' },
  stage1: { icon: Search, label: '1차 분석', color: 'text-yellow-400' },
  stage2: { icon: Brain, label: '2차 분석', color: 'text-purple-400' },
  done: { icon: CheckCircle2, label: '완료', color: 'text-green-400' },
  error: { icon: AlertCircle, label: '오류', color: 'text-destructive' },
};

const PHASE_ORDER = ['filtering', 'correlating', 'stage1', 'stage2', 'done'] as const;

const AnalysisProgressBar = ({ progress }: AnalysisProgressBarProps) => {
  if (!progress) return null;

  const config = phaseConfig[progress.phase];
  const Icon = config.icon;
  const isActive = progress.phase !== 'done' && progress.phase !== 'error';

  // Determine which phases to show based on whether correlating is used
  const hasCorrelating = progress.phase === 'correlating' || false;
  const phases = hasCorrelating
    ? (['filtering', 'correlating', 'stage2', 'done'] as const)
    : (['filtering', 'stage1', 'stage2', 'done'] as const);

  // Overall progress calculation
  let overallPercent = 0;
  switch (progress.phase) {
    case 'filtering':
      overallPercent = Math.round(progress.percent * 0.4);
      break;
    case 'correlating':
      overallPercent = 40 + Math.round(progress.percent * 0.2);
      break;
    case 'stage1':
      overallPercent = 40 + Math.round(progress.percent * 0.3);
      break;
    case 'stage2':
      overallPercent = hasCorrelating
        ? 60 + Math.round(progress.percent * 0.4)
        : 70 + Math.round(progress.percent * 0.3);
      break;
    case 'done':
      overallPercent = 100;
      break;
  }

  const allPhases = PHASE_ORDER as readonly string[];

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      {/* Phase indicators */}
      <div className="flex items-center justify-between text-xs">
        {phases.map((phase, idx) => {
          const pc = phaseConfig[phase];
          const PhaseIcon = pc.icon;
          const isCurrent = progress.phase === phase;
          const isPast = allPhases.indexOf(progress.phase) > allPhases.indexOf(phase);

          return (
            <div key={phase} className="flex items-center gap-1.5">
              {idx > 0 && (
                <div className={`w-8 h-px ${isPast ? 'bg-primary' : 'bg-border'} mx-1`} />
              )}
              <div className={`flex items-center gap-1 ${isCurrent ? pc.color : isPast ? 'text-primary' : 'text-muted-foreground/50'}`}>
                {isCurrent && isActive ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PhaseIcon className="w-3.5 h-3.5" />
                )}
                <span className={isCurrent ? 'font-medium' : ''}>{pc.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <Progress value={overallPercent} className="h-2" />

      {/* Status message */}
      <div className="flex items-center justify-between text-xs">
        <span className={`${config.color} flex items-center gap-1.5`}>
          {isActive && <Loader2 className="w-3 h-3 animate-spin" />}
          {progress.message}
        </span>
        <span className="text-muted-foreground">{overallPercent}%</span>
      </div>
    </div>
  );
};

export default AnalysisProgressBar;
