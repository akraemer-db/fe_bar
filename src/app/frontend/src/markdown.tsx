// Minimal markdown renderer for work order drafts: headings, bullets, numbered lists,
// paragraphs, **bold** and `code`. Renders React nodes (no innerHTML), so draft text is safe.
import { Fragment, type ReactNode } from "react";

function renderInline(text: string, key: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((part) => part !== "")
    .map((part, i) => {
      const k = `${key}-${i}`;
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return <strong key={k}>{part.slice(2, -2)}</strong>;
      }
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return <code key={k}>{part.slice(1, -1)}</code>;
      }
      return <Fragment key={k}>{part}</Fragment>;
    });
}

export function Markdown({ source }: { source: string }) {
  const out: ReactNode[] = [];
  let n = 0;
  const key = () => `md-${n++}`;
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    const k = key();
    out.push(
      <p key={k}>
        {para.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {renderInline(line, `${k}-${i}`)}
          </Fragment>
        ))}
      </p>,
    );
    para = [];
  };

  const flushList = () => {
    if (!list) return;
    const k = key();
    const items = list.items.map((item, i) => <li key={i}>{renderInline(item, `${k}-${i}`)}</li>);
    out.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>);
    list = null;
  };

  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (line.trim() === "") {
      flushPara();
      flushList();
    } else if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const k = key();
      const content = renderInline(heading[2], k);
      out.push(
        level === 1 ? <h3 key={k}>{content}</h3> : level === 2 ? <h4 key={k}>{content}</h4> : <h5 key={k}>{content}</h5>,
      );
    } else if (bullet || ordered) {
      flushPara();
      const isOrdered = !bullet;
      const text = (bullet ?? ordered)?.[1] ?? "";
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(text);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return <div className="md">{out}</div>;
}
