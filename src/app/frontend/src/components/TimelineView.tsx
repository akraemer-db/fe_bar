import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errMsg } from "../api";
import { MODE_LABEL, MODE_SHORT, STATUS_LABEL, fmtDay, fmtDayTime, fmtUsdFull, hhmm, parseLocal } from "../format";
import { useToast } from "../toast";
import type { StageGap, Timeline, TimelineBlock, WorkOrder, WorkOrderStatus } from "../types";

const HOURS = 48;
const ACTIONABLE: Exclude<WorkOrderStatus, "scheduled">[] = ["dispatched", "in_progress", "done"];
const LEGEND_STATUSES: WorkOrderStatus[] = ["scheduled", "dispatched", "in_progress", "done"];
const HOUR_MS = 3_600_000;

const fleetOf = (pumpId: string) => pumpId.split("-")[0];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const pct = (x: number) => `${(x * 100).toFixed(3)}%`;

interface Popover {
  block: TimelineBlock;
  x: number;
  y: number;
}

export function TimelineView() {
  const notify = useToast();
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [fleetFilter, setFleetFilter] = useState("ALL");
  const [popover, setPopover] = useState<Popover | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, w] = await Promise.all([api.timeline(HOURS), api.workOrders()]);
      setTimeline(t);
      setOrders(w);
    } catch (e) {
      notify(errMsg(e), "error");
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const techInfo = useMemo(
    () => new Map((timeline?.technicians ?? []).map((t) => [t.tech_id, t] as const)),
    [timeline],
  );
  const techName = (id: string) => techInfo.get(id)?.name ?? id;

  const chart = useMemo(() => {
    if (!timeline) return null;
    const t0 = parseLocal(timeline.now).getTime();
    const span = HOURS * HOUR_MS;
    const pos = (iso: string) => clamp01((parseLocal(iso).getTime() - t0) / span);

    const blockFleets = new Set(timeline.blocks.map((b) => fleetOf(b.pump_id)));
    const allFleets = [
      ...new Set([
        ...timeline.technicians.map((t) => t.home_fleet_id),
        ...timeline.stage_gaps.map((g) => g.fleet_id),
        ...blockFleets,
      ]),
    ].sort();
    const visibleFleets = fleetFilter === "ALL" ? [...blockFleets].sort() : [fleetFilter];

    const groups = visibleFleets.map((fleet) => {
      const techIds = [
        ...new Set([
          ...timeline.technicians.filter((t) => t.home_fleet_id === fleet).map((t) => t.tech_id),
          ...timeline.blocks.filter((b) => fleetOf(b.pump_id) === fleet).map((b) => b.tech_id),
        ]),
      ];
      return {
        fleet,
        rows: techIds.map((id) => ({
          techId: id,
          // Blocks that already ended before the window start are not drawn.
          blocks: timeline.blocks.filter(
            (b) => b.tech_id === id && fleetOf(b.pump_id) === fleet && parseLocal(b.end).getTime() > t0,
          ),
        })),
        gaps: timeline.stage_gaps.filter((g) => g.fleet_id === fleet),
      };
    });

    // Hour ticks: a line every hour, a label every 3 hours.
    const ticks: { x: number; label: string | null }[] = [];
    const anchor = new Date(t0);
    anchor.setMinutes(0, 0, 0);
    for (let k = 1; k <= HOURS; k++) {
      const tk = new Date(anchor.getTime() + k * HOUR_MS);
      const x = (tk.getTime() - t0) / span;
      if (x <= 0 || x >= 1) continue;
      ticks.push({ x, label: tk.getHours() % 3 === 0 ? `${String(tk.getHours()).padStart(2, "0")}:00` : null });
    }

    // Day segments for the header row.
    const days: { label: string; x: number; w: number }[] = [];
    const cursor = new Date(t0);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() < t0 + span) {
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      const s = Math.max(cursor.getTime(), t0);
      const e = Math.min(next.getTime(), t0 + span);
      days.push({ label: fmtDay(cursor), x: (s - t0) / span, w: (e - s) / span });
      cursor.setTime(next.getTime());
    }

    return { t0, pos, groups, allFleets, ticks, days, nowPos: 0 };
  }, [timeline, fleetFilter]);

  const setStatus = async (woId: string, status: Exclude<WorkOrderStatus, "scheduled">) => {
    setSaving(true);
    try {
      await api.patchWorkOrder(woId, status);
      notify(`${woId} marked ${STATUS_LABEL[status].toLowerCase()}`, "success");
      setPopover(null);
      await load();
    } catch (e) {
      notify(errMsg(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const recentOrders = useMemo(
    () => [...(orders ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12),
    [orders],
  );

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>Technician timeline, next {HOURS} hrs</h2>
          <div className="filter">
            <label htmlFor="fleet-filter" className="small muted">
              Fleet
            </label>
            <select id="fleet-filter" value={fleetFilter} onChange={(e) => setFleetFilter(e.target.value)}>
              <option value="ALL">All fleets with work orders</option>
              {(chart?.allFleets ?? []).map((f) => (
                <option key={f} value={f}>
                  Fleet {f}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="legend small">
          <span className="legend-item">
            <i className="swatch swatch-gap" /> Stage gap
          </span>
          {LEGEND_STATUSES.map((s) => (
            <span className="legend-item" key={s}>
              <i className={`swatch swatch-${s}`} /> {STATUS_LABEL[s]}
            </span>
          ))}
        </div>

        {timeline === null || chart === null ? (
          <div className="empty">Loading timeline...</div>
        ) : chart.groups.length === 0 ? (
          <div className="empty">No work orders in this window. Dispatch from Ranked Actions to see blocks here.</div>
        ) : (
          <div className="gantt-scroll">
            <div className="gantt">
              <div className="gantt-head">
                <div className="gantt-label-col small muted">Technician</div>
                <div className="gantt-axis">
                  <div className="axis-days">
                    {chart.days.map((d, i) => (
                      <div key={i} className="axis-day small" style={{ left: pct(d.x), width: pct(d.w) }}>
                        {d.label}
                      </div>
                    ))}
                  </div>
                  <div className="axis-ticks">
                    {chart.ticks.map((t, i) => (
                      <div key={i} className={t.label ? "tick major" : "tick"} style={{ left: pct(t.x) }}>
                        {t.label && <span className="tick-label">{t.label}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {chart.groups.map((g) => (
                <section className="gantt-group" key={g.fleet}>
                  <div className="gantt-group-title small">
                    <strong>Fleet {g.fleet}</strong>
                    <span className="muted">
                      {" "}
                      · {g.rows.reduce((n, r) => n + r.blocks.length, 0)} work order
                      {g.rows.reduce((n, r) => n + r.blocks.length, 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="gantt-overlay" aria-hidden="true">
                    {g.gaps.map((gap) => (
                      <GapBand key={`${gap.gap_start}-${gap.fleet_id}`} gap={gap} pos={chart.pos} />
                    ))}
                  </div>
                  {g.rows.map((row) => (
                    <div className="gantt-row" key={row.techId}>
                      <div className="gantt-label">
                        <div>{techName(row.techId)}</div>
                        <div className="small muted">
                          {techInfo.get(row.techId)?.skill ?? ""} · {techInfo.get(row.techId)?.shift ?? ""}
                        </div>
                      </div>
                      <div className="gantt-track">
                        {row.blocks.map((b) => {
                          const s = chart.pos(b.start);
                          const e = Math.max(chart.pos(b.end), s);
                          const flip = e > 0.72;
                          return (
                            <BlockView
                              key={b.wo_id}
                              block={b}
                              startPct={s}
                              endPct={e}
                              flip={flip}
                              onOpen={(el) => {
                                const r = el.getBoundingClientRect();
                                setPopover({
                                  block: b,
                                  x: Math.max(8, Math.min(r.left, window.innerWidth - 300)),
                                  y: r.bottom + 6,
                                });
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              ))}

              <div className="gantt-now" style={{ left: `calc(var(--label-w) + (100% - var(--label-w)) * ${chart.nowPos})` }}>
                <span className="now-tag">now {hhmm(timeline.now)}</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {popover && (
        <WorkOrderPopover
          popover={popover}
          order={orders?.find((o) => o.wo_id === popover.block.wo_id) ?? null}
          techName={techName(popover.block.tech_id)}
          saving={saving}
          onClose={() => setPopover(null)}
          onStatus={setStatus}
        />
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Recent work orders</h2>
          <span className="muted small">Newest first</span>
        </div>
        {orders === null ? (
          <div className="empty">Loading work orders...</div>
        ) : recentOrders.length === 0 ? (
          <div className="empty">No work orders yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Pump</th>
                  <th>Mode</th>
                  <th>Tech</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th className="num">Expected $ protected</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((w) => (
                  <tr key={w.wo_id}>
                    <td className="mono">{w.wo_id}</td>
                    <td className="mono">{w.pump_id}</td>
                    <td>{MODE_LABEL[w.failure_mode] ?? w.failure_mode}</td>
                    <td>{w.tech_name ?? techName(w.tech_id)}</td>
                    <td>
                      {fmtDayTime(w.window_start)} to {hhmm(w.window_end)}
                    </td>
                    <td>
                      <StatusPill status={w.status} />
                    </td>
                    <td className="num money">{fmtUsdFull(w.expected_savings_usd)}</td>
                    <td className="small">{fmtDayTime(w.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function GapBand({ gap, pos }: { gap: StageGap; pos: (iso: string) => number }) {
  const s = pos(gap.gap_start);
  const e = pos(gap.gap_end);
  if (e <= s) return null;
  return (
    <div
      className="gap-band"
      style={{ left: pct(s), width: pct(e - s) }}
      title={`Stage gap after stage ${gap.after_stage}: ${fmtDayTime(gap.gap_start)} to ${hhmm(gap.gap_end)}`}
    />
  );
}

function BlockView({
  block,
  startPct,
  endPct,
  flip,
  onOpen,
}: {
  block: TimelineBlock;
  startPct: number;
  endPct: number;
  flip: boolean;
  onOpen: (el: HTMLElement) => void;
}) {
  const label = `${block.wo_id} · ${block.pump_id} · ${MODE_SHORT[block.failure_mode] ?? block.failure_mode}`;
  const labelStyle = flip
    ? { right: `calc(${pct(1 - startPct)} + 6px)` }
    : { left: `calc(${pct(endPct)} + 6px)` };
  return (
    <>
      <button
        type="button"
        className={`wo-block status-${block.status}`}
        style={{ left: pct(startPct), width: pct(Math.max(endPct - startPct, 0.002)) }}
        title={label}
        aria-label={label}
        onClick={(e) => onOpen(e.currentTarget)}
      />
      <span className="wo-label" style={labelStyle}>
        {label}
      </span>
    </>
  );
}

function StatusPill({ status }: { status: WorkOrderStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

function WorkOrderPopover({
  popover,
  order,
  techName,
  saving,
  onClose,
  onStatus,
}: {
  popover: Popover;
  order: WorkOrder | null;
  techName: string;
  saving: boolean;
  onClose: () => void;
  onStatus: (woId: string, status: Exclude<WorkOrderStatus, "scheduled">) => void;
}) {
  const b = popover.block;
  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover" style={{ left: popover.x, top: popover.y }} role="dialog" aria-label={`${b.wo_id} details`}>
        <div className="popover-head">
          <strong>{b.wo_id}</strong>
          <StatusPill status={b.status} />
        </div>
        <dl className="kv small">
          <dt>Pump</dt>
          <dd className="mono">{b.pump_id}</dd>
          <dt>Mode</dt>
          <dd>{MODE_LABEL[b.failure_mode] ?? b.failure_mode}</dd>
          <dt>Tech</dt>
          <dd>{order?.tech_name ?? techName}</dd>
          <dt>Window</dt>
          <dd>
            {fmtDayTime(b.start)} to {hhmm(b.end)}
          </dd>
          <dt>Expected $ protected</dt>
          <dd>{order ? fmtUsdFull(order.expected_savings_usd) : "n/a"}</dd>
        </dl>
        <div className="popover-actions">
          {ACTIONABLE.map((s) => (
            <button
              key={s}
              type="button"
              className={`btn btn-sm ${b.status === s ? "btn-current" : ""}`}
              disabled={saving || b.status === s}
              onClick={() => onStatus(b.wo_id, s)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="small muted">Click a status to update it. Current status is highlighted.</div>
      </div>
    </>
  );
}
