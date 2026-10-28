import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

export interface SparkPoint {
  t: string;
  v: number;
}

/** Small line with a dashed fleet median reference. */
export function Sparkline({ data, median }: { data: SparkPoint[]; median: number }) {
  const values = data.map((d) => d.v);
  const lo = Math.min(...values, median);
  const hi = Math.max(...values, median);
  const pad = (hi - lo) * 0.1 || 1;
  return (
    <div className="spark">
      <ResponsiveContainer width="100%" height={56}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="t" hide />
          <YAxis hide domain={[lo - pad, hi + pad]} />
          <ReferenceLine y={median} stroke="#8a94a3" strokeDasharray="4 3" />
          <Line type="monotone" dataKey="v" stroke="#1d5fd1" strokeWidth={1.8} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
