import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { dashboardStats } from '@/data/mockLogs';

const pieData = [
  { name: 'Critical', value: dashboardStats.critical, color: 'hsl(0, 72%, 51%)' },
  { name: 'Warning', value: dashboardStats.warning, color: 'hsl(38, 92%, 50%)' },
  { name: 'Info', value: dashboardStats.info, color: 'hsl(210, 100%, 56%)' },
];

const timeData = [
  { time: '09:12', critical: 0, warning: 0, info: 1 },
  { time: '09:15', critical: 0, warning: 0, info: 1 },
  { time: '09:30', critical: 0, warning: 2, info: 0 },
  { time: '09:45', critical: 3, warning: 0, info: 0 },
  { time: '09:46', critical: 1, warning: 1, info: 0 },
  { time: '09:50', critical: 1, warning: 1, info: 1 },
  { time: '10:00', critical: 0, warning: 0, info: 1 },
  { time: '10:05', critical: 0, warning: 1, info: 0 },
];

const SeverityChart = () => {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 font-heading">위험도 분포</h3>
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" stroke="none">
              {pieData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'hsl(220, 18%, 13%)', border: '1px solid hsl(220, 14%, 20%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210, 20%, 92%)' }}
            />
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
        <h3 className="text-sm font-semibold text-foreground mb-3 font-heading">시간대별 로그 발생</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={timeData} barSize={12}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 20%)" />
            <XAxis dataKey="time" tick={{ fill: 'hsl(215, 15%, 55%)', fontSize: 10 }} axisLine={false} />
            <YAxis tick={{ fill: 'hsl(215, 15%, 55%)', fontSize: 10 }} axisLine={false} />
            <Tooltip contentStyle={{ background: 'hsl(220, 18%, 13%)', border: '1px solid hsl(220, 14%, 20%)', borderRadius: '8px', fontSize: '12px', color: 'hsl(210, 20%, 92%)' }} />
            <Bar dataKey="critical" stackId="a" fill="hsl(0, 72%, 51%)" radius={[0, 0, 0, 0]} />
            <Bar dataKey="warning" stackId="a" fill="hsl(38, 92%, 50%)" />
            <Bar dataKey="info" stackId="a" fill="hsl(210, 100%, 56%)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SeverityChart;
