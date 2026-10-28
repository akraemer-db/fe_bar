import { mockRequest } from "./mock";
import type {
  Action,
  GenieResponse,
  Health,
  Rescore,
  Summary,
  Technician,
  Timeline,
  Trend,
  WorkOrder,
  WorkOrderCreate,
  WorkOrderDraft,
  WorkOrderStatus,
} from "./types";

/** True when the app runs against src/mock.ts instead of the FastAPI backend (npm run dev:mock). */
export const IS_MOCK = import.meta.env.VITE_MOCK === "1";

type Method = "GET" | "POST" | "PATCH";

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    // FastAPI validation errors come back as an array of {msg, loc, ...}.
    if (Array.isArray(detail)) {
      return detail.map((d) => (d && typeof d === "object" && "msg" in d ? String(d.msg) : JSON.stringify(d))).join("; ");
    }
  }
  return `Request failed (HTTP ${status})`;
}

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  if (IS_MOCK) return mockRequest<T>(method, path, body);

  const headers: Record<string, string> = { Accept: "application/json" };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(path, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new Error(errorMessage(data, res.status));
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<Health>("GET", "/api/health"),
  summary: () => request<Summary>("GET", "/api/summary"),
  actions: () => request<Action[]>("GET", "/api/actions"),
  trend: (pumpId: string) => request<Trend>("GET", `/api/pumps/${enc(pumpId)}/trend`),
  rescore: (pumpId: string) => request<Rescore>("POST", `/api/pumps/${enc(pumpId)}/rescore`),
  draftWorkOrder: (pumpId: string) => request<WorkOrderDraft>("POST", "/api/work_orders/draft", { pump_id: pumpId }),
  technicians: (fleetId: string) => request<Technician[]>("GET", `/api/technicians?fleet_id=${enc(fleetId)}`),
  createWorkOrder: (body: WorkOrderCreate) => request<WorkOrder>("POST", "/api/work_orders", body),
  workOrders: () => request<WorkOrder[]>("GET", "/api/work_orders"),
  patchWorkOrder: (woId: string, status: WorkOrderStatus) =>
    request<WorkOrder>("PATCH", `/api/work_orders/${enc(woId)}`, { status }),
  timeline: (hours: number) => request<Timeline>("GET", `/api/timeline?hours=${hours}`),
  genieAsk: (question: string, conversationId: string | null) =>
    request<GenieResponse>("POST", "/api/genie/ask", { question, conversation_id: conversationId }),
};

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
