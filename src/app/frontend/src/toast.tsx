import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
type Notify = (text: string, kind?: ToastKind) => void;

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

const ToastContext = createContext<Notify>(() => undefined);

/** Non-blocking toast stack. Use `useToast()` to get the notify function. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const notify = useCallback<Notify>((text, kind = "info") => {
    counter.current += 1;
    const id = counter.current;
    setItems((prev) => [...prev, { id, text, kind }]);
    window.setTimeout(
      () => setItems((prev) => prev.filter((t) => t.id !== id)),
      kind === "error" ? 6000 : 4000,
    );
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Notify {
  return useContext(ToastContext);
}
