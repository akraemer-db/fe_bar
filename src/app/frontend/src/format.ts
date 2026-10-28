import type { BestAction, FailureMode, WorkOrderStatus } from "./types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const MODE_LABEL: Record<FailureMode, string> = {
  valve_seat_washout: "Valve/seat washout",
  packing_failure: "Packing failure",
  power_end_bearing: "Power end bearing",
};

export const MODE_SHORT: Record<FailureMode, string> = {
  valve_seat_washout: "Valve seat",
  packing_failure: "Packing",
  power_end_bearing: "Power end",
};

export const ACTION_LABEL: Record<BestAction, string> = {
  keep_running: "Keep running",
  swap_at_next_gap: "Swap at next stage gap",
  pull_now: "Pull now, standby online",
};

export const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  in_progress: "In progress",
  done: "Done",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Parses an ISO timestamp without offset as local wall-clock time (no timezone shift). */
export function parseLocal(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  if (!m) return new Date(iso);
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] ? Number(m[6]) : 0,
  );
}

/** Formats a Date as an ISO string without offset (local wall-clock). */
export function toIsoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** "Tue 14:20" */
export function fmtDayTime(iso: string | null | undefined): string {
  if (!iso) return "none";
  const d = parseLocal(iso);
  return `${DAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "14:20" */
export function hhmm(iso: string): string {
  const d = parseLocal(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Tue 28 Oct" */
export function fmtDay(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Value for an <input type="datetime-local">. */
export function toInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  return toIsoLocal(parseLocal(iso)).slice(0, 16);
}

/** Converts a datetime-local value back to an ISO string without offset. */
export function fromInputValue(value: string): string {
  return value.length === 16 ? `${value}:00` : value;
}

/** $48.7k / $1.2M / -$61.4k */
export function fmtUsd(value: number): string {
  const sign = value < 0 ? "-" : "";
  const a = Math.abs(value);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

/** $85,292 */
export function fmtUsdFull(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
}

export function fmtPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
