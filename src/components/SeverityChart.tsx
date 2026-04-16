import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

interface SeverityChartProps {
  stats: {
    critical: number;
    warning: number;
    info: number;
    totalLines: number;
  };
}

const SeverityChart = ({ stats }: SeverityChartProps) => {
  const pieData = [
    { name: 'Critical', value: stats.critical, color: 'hsl(0, 72%, 51%)' },
    { name: 'Warning', value: stats.warning, color: 'hsl(38, 92%, 50%)' },
    { name: 'Info', value: stats.info, color: 'hsl(210, 100%, 56%)' },
  ];

  const tooltipStyle = { background: 'hsl(220, 18%, 13%)', border: '1px solid hsl(220, 14%, 20%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210, 20%, 92%)' };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 font-heading">위험도 분포</h3>
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" stroke="none">
              {pieData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex justify-center gap-4 mt-2">
          {pieData.map((d) => (
            <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
              {d.name}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 font-heading">위험도 요약</h3>
        <div className="flex flex-col items-center justify-center h-[180px] gap-4">
          <div className="text-4xl font-bold font-heading text-foreground">{stats.totalLines}</div>
          <div className="text-xs text-muted-foreground">총 분석 라인</div>
          <div className="flex gap-6 text-sm">
            <div className="text-center">
              <span className="text-2xl font-bold text-critical">{stats.critical}</span>
              <p className="text-xs text-muted-foreground mt-1">Critical</p>
            </div>
            <div className="text-center">
              <span className="text-2xl font-bold text-warning">{stats.warning}</span>
              <p className="text-xs text-muted-foreground mt-1">Warning</p>
            </div>
            <div className="text-center">
              <span className="text-2xl font-bold text-info">{stats.info}</span>
              <p className="text-xs text-muted-foreground mt-1">Info</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SeverityChart;
