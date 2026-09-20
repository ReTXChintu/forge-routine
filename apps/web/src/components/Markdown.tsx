import { type ReactNode } from 'react';

import { CodeBlock } from './CodeBlock';

/**
 * Renders the markdown a model actually produces.
 *
 * Deliberately not a markdown library. What comes back from these agents
 * is a narrow, predictable subset — fenced code, inline code, bold,
 * headings, and the two kinds of list — and a full CommonMark
 * implementation plus a syntax highlighter is a large dependency to carry
 * for that, in an app that has already stripped one component library out
 * for the same reason.
 *
 * Nothing here interprets HTML. Everything becomes React nodes, so a model
 * that emits a `<script>` renders it as the text it is.
 */
export function Markdown({ content }: { content: string }) {
  return <div className="col g3">{renderBlocks(content)}</div>;
}

/** Splits on fences first, because nothing inside one is markdown. */
function renderBlocks(content: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const fence = /```([\w+-]*)\n?([\s\S]*?)```/g;

  let lastIndex = 0;
  let key = 0;

  for (let match = fence.exec(content); match !== null; match = fence.exec(content)) {
    if (match.index > lastIndex) {
      nodes.push(...renderProse(content.slice(lastIndex, match.index), `p${key}`));
    }

    nodes.push(
      <CodeBlock
        key={`c${key++}`}
        code={match[2]!.replace(/\n$/, '')}
        language={match[1] || null}
      />,
    );
    lastIndex = match.index + match[0].length;
  }

  // An unterminated fence — the model was cut off mid-block. Render what
  // there is as code rather than dumping the backticks as prose.
  const tail = content.slice(lastIndex);
  const unclosed = /```([\w+-]*)\n?([\s\S]*)$/.exec(tail);
  if (unclosed) {
    nodes.push(...renderProse(tail.slice(0, unclosed.index), `p${key}`));
    nodes.push(
      <CodeBlock key={`c${key}`} code={unclosed[2] ?? ''} language={unclosed[1] || null} />,
    );
  } else if (tail.trim().length > 0) {
    nodes.push(...renderProse(tail, `p${key}`));
  }

  return nodes;
}

const BULLET = /^\s*[-*+]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

function renderProse(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    nodes.push(
      <p key={`${keyPrefix}-t${key++}`} className="t-body" style={{ margin: 0 }}>
        {renderInline(paragraph.join(' '))}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    nodes.push(
      <Tag
        key={`${keyPrefix}-l${key++}`}
        className="t-body"
        style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        {list.items.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const line of lines) {
    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      // Every level renders as the same weight. A model's choice between
      // ## and ### inside a chat bubble is arbitrary, and honouring it
      // produces wildly different type sizes in one reply.
      nodes.push(
        <div key={`${keyPrefix}-h${key++}`} className="t-h4">
          {renderInline(heading[2]!)}
        </div>,
      );
      continue;
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      flushParagraph();
      const ordered = NUMBERED.test(line);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(line.replace(ordered ? NUMBERED : BULLET, ''));
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();

  return nodes;
}

/** Inline code, bold, italic and links. Left alone otherwise. */
const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  INLINE.lastIndex = 0;
  for (let match = INLINE.exec(text); match !== null; match = INLINE.exec(text)) {
    const [whole, code, bold, italic, link, href] = match;

    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    lastIndex = match.index + whole.length;

    if (code) {
      nodes.push(
        <code
          key={key++}
          className="mono"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '1px 5px',
            fontSize: '0.92em',
          }}
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      nodes.push(
        <strong key={key++} style={{ color: 'var(--text-primary)', fontWeight: 650 }}>
          {bold.slice(2, -2)}
        </strong>,
      );
    } else if (italic) {
      nodes.push(<em key={key++}>{italic.slice(1, -1)}</em>);
    } else if (link && href) {
      nodes.push(
        // Only http(s) matched above, so no javascript: URL can reach here.
        <a key={key++} href={href} target="_blank" rel="noreferrer" className="text-primary-c">
          {link.slice(1, link.indexOf(']'))}
        </a>,
      );
    }
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));

  return nodes;
}
