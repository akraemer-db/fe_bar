import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "../api";
import { fmtUsdFull } from "../format";
import { useToast } from "../toast";
import type { GenieResponse } from "../types";

const SUGGESTIONS = [
  "What's the expected $ protected by this week's work orders, by fleet?",
  "Which fleets had the most pump-caused NPT last quarter?",
  "What is MTBF by failure mode?",
];

const MAX_ROWS = 20;

type Message =
  | { role: "user"; text: string }
  | { role: "genie"; resp: GenieResponse }
  | { role: "error"; text: string };

export function GeniePanel({ onClose }: { onClose: () => void }) {
  const notify = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setPending(true);
    try {
      const resp = await api.genieAsk(q, conversationId);
      setConversationId(resp.conversation_id);
      setMessages((m) => [...m, { role: "genie", resp }]);
    } catch (e) {
      const text = errMsg(e);
      notify(text, "error");
      setMessages((m) => [...m, { role: "error", text }]);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="genie">
      <div className="genie-head">
        <div>
          <h2>Ask Genie</h2>
          <div className="small muted">Natural language questions over the fleet data</div>
        </div>
        <div className="genie-head-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setMessages([]);
              setConversationId(null);
            }}
            disabled={pending}
          >
            New conversation
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="genie-list" ref={listRef}>
        {messages.length === 0 && !pending && (
          <div className="genie-empty small muted">Pick a suggested question or type your own.</div>
        )}
        {messages.map((m, i) => {
          if (m.role === "user") return <div key={i} className="msg msg-user">{m.text}</div>;
          if (m.role === "error") return <div key={i} className="msg msg-error">{m.text}</div>;
          return <GenieAnswer key={i} resp={m.resp} />;
        })}
        {pending && (
          <div className="loading-row small">
            <span className="spinner" aria-hidden="true" />
            <span>Genie is working on it. This can take 10 to 30 seconds.</span>
          </div>
        )}
      </div>

      <div className="genie-chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip" disabled={pending} onClick={() => void ask(s)}>
            {s}
          </button>
        ))}
      </div>

      <form
        className="genie-input"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <textarea
          value={input}
          placeholder="Ask about pumps, work orders, NPT, MTBF..."
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
          disabled={pending}
        />
        <button type="submit" className="btn btn-primary" disabled={pending || input.trim() === ""}>
          Send
        </button>
      </form>
    </div>
  );
}

function GenieAnswer({ resp }: { resp: GenieResponse }) {
  const shown = resp.rows.slice(0, MAX_ROWS);
  return (
    <div className="msg msg-genie">
      {resp.answer_text.split(/\n\n+/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}

      {resp.sql && (
        <details className="sql-block">
          <summary className="small">SQL</summary>
          <pre>{resp.sql}</pre>
        </details>
      )}

      {resp.columns.length > 0 && (
        <>
          <div className="table-wrap genie-table">
            <table className="data-table compact">
              <thead>
                <tr>
                  {resp.columns.map((c) => (
                    <th key={c} className={/usd|\$|cost|saved|protected/i.test(c) ? "num" : undefined}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className={/usd|cost|saved|protected/i.test(resp.columns[c] ?? "") ? "num" : undefined}
                      >
                        {formatCell(cell, resp.columns[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {resp.rows.length > MAX_ROWS && (
            <div className="small muted">Showing {MAX_ROWS} of {resp.rows.length} rows.</div>
          )}
        </>
      )}
    </div>
  );
}

function formatCell(value: unknown, column: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (/usd|cost|saved|protected/i.test(column)) return fmtUsdFull(value);
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return String(value);
}
