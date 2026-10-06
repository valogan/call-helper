import type { ReactNode } from 'react';

/**
 * Minimal, dependency-free markdown renderer for AI notes. Deliberately small:
 * headings, lists, code fences, bold, inline code, paragraphs. Everything is
 * rendered as React text nodes, so no HTML-injection surface exists.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on **bold** and `code` while keeping the delimiters.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(pattern);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith('`') && part.endsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-c${i}`}>{part.slice(1, -1)}</code>);
    } else {
      nodes.push(<span key={`${keyPrefix}-t${i}`}>{part}</span>);
    }
  });
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] | null = null;
  let code: string[] | null = null;
  let paragraph: string[] | null = null;

  const flushList = () => {
    if (list) {
      const items = list;
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {items.map((item, i) => (
            <li key={i}>{renderInline(item, `li-${blocks.length}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = null;
    }
  };
  const flushParagraph = () => {
    if (paragraph) {
      const content = paragraph.join(' ');
      blocks.push(<p key={`p-${blocks.length}`}>{renderInline(content, `pp-${blocks.length}`)}</p>);
      paragraph = null;
    }
  };
  const flushAll = () => {
    flushList();
    flushParagraph();
  };

  for (const line of text.split('\n')) {
    const idx = blocks.length;
    if (line.trim().startsWith('```')) {
      if (code !== null) {
        const content = code.join('\n');
        blocks.push(
          <pre key={`pre-${idx}`}>
            <code>{content}</code>
          </pre>,
        );
        code = null;
      } else {
        flushAll();
        code = [];
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const content = renderInline(heading[2], `h-${idx}`);
      if (level === 1) blocks.push(<h3 key={`h-${idx}`}>{content}</h3>);
      else if (level === 2) blocks.push(<h4 key={`h-${idx}`}>{content}</h4>);
      else blocks.push(<h5 key={`h-${idx}`}>{content}</h5>);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (list === null) list = [];
      list.push(bullet[1]);
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      if (list === null) list = [];
      list.push(numbered[1]);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    flushList();
    if (paragraph === null) paragraph = [];
    paragraph.push(line.trim());
  }
  flushList();
  flushParagraph();
  if (code !== null) {
    blocks.push(
      <pre key="pre-tail">
        <code>{code.join('\n')}</code>
      </pre>,
    );
  }

  return <div className="markdown">{blocks}</div>;
}
