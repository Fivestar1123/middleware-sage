import { AlertTriangle, AlertOctagon, Info, FileText } from 'lucide-react';

interface DashboardStats {
  critical: number;
  warning: number;
  info: number;
  totalLines: number;
}

interface StatusCardsProps {
  stats: DashboardStats;
}

const StatusCards = ({ stats }: StatusCardsProps) => {
  const cards = [
    { label: 'Critical', value: stats.critical, icon: AlertOctagon, colorClass: 'text-critical bg-critical/10 border-critical/20' },
    { label: 'Warning', value: stats.warning, icon: AlertTriangle, colorClass: 'text-warning bg-warning/10 border-warning/20' },
    { label: 'Info', value: stats.info, icon: Info, colorClass: 'text-info bg-info/10 border-info/20' },
    { label: 'Total Lines', value: stats.totalLines, icon: FileText, colorClass: 'text-foreground bg-muted border-border' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
      {cards.map((card) => (
        <div key={card.label} className={`rounded-lg border p-4 ${card.colorClass}`}>
          <div className="flex items-center justify-between">
            <card.icon className="w-4 h-4" />
            <span className="text-2xl font-bold font-heading">{card.value}</span>
          </div>
          <p className="text-xs mt-1 opacity-80">{card.label}</p>
        </div>
      ))}
    </div>
  );
};

export default StatusCards;
