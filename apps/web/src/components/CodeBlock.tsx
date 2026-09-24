import { useState, type ReactNode } from 'react';

import { copyText } from '~/lib/browser.js';

import { Icon } from './Icon';

/**
 * A fenced code block, highlighted and copyable.
 *
 * The highlighting is a small tokeniser rather than a library. The design
 * system already ships the token colours (`cb-kw`, `cb-str`, and the rest)
 * because the prototype hand-marked them, so the job here is only to
 * produce those spans — and a syntax-highlighting dependency to colour a
 * twelve-line snippet would be several hundred kilobytes for that.
 *
 * It builds React nodes rather than HTML. Model output is text from a
 * third party, and `dangerouslySetInnerHTML` over it is how a chat window
 * becomes an XSS hole.
 */
export function CodeBlock({ code, language }: { code: string; language?: string | null }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    // `navigator.clipboard` is secure-context-only and this app is served
    // over plain HTTP, so the helper falls back rather than doing nothing.
    void copyText(code).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  };

  return (
    <div className="code-block" style={{ position: 'relative' }}>
      <div
        className="row items-center justify-between"
        style={{
          padding: '6px 10px 6px 14px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span className="t-caption mono">{language || 'code'}</span>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 26, height: 26 }}
          onClick={copy}
          title={copied ? 'Copied' : 'Copy'}
        >
          <Icon name={copied ? 'check' : 'code'} size={13} />
        </button>
      </div>

      <pre style={{ whiteSpace: 'pre', overflowX: 'auto' }}>{highlight(code, language)}</pre>
    </div>
  );
}

/** Languages the tokeniser below actually understands. */
const C_FAMILY = new Set([
  'js',
  'jsx',
  'javascript',
  'ts',
  'tsx',
  'typescript',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'php',
  'swift',
  'kotlin',
]);

const KEYWORDS = new Set([
  'abstract',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'set',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'yield',
]);

/**
 * One pass, longest-match-first.
 *
 * Order matters and is the whole correctness argument: comments and
 * strings come first so a `//` inside a string, or a keyword inside a
 * comment, is never mistaken for code.
 */
const TOKEN = new RegExp(
  [
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|#[^\\n]*)', // 1 comment
    '(`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')', // 2 string
    '(\\b\\d[\\d_.]*\\b)', // 3 number
    '([A-Za-z_$][\\w$]*)(?=\\s*\\()', // 4 call
    '([A-Za-z_$][\\w$]*)', // 5 word
  ].join('|'),
  'g',
);

function highlight(code: string, language?: string | null): ReactNode {
  const lang = (language ?? '').toLowerCase();

  // Unknown language: plain text. Mis-colouring Python as JavaScript reads
  // as a rendering bug, and no colour at all reads as a plain snippet.
  if (lang && !C_FAMILY.has(lang)) return code;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(code); match !== null; match = TOKEN.exec(code)) {
    const [text, comment, string, number, call, word] = match;

    if (match.index > lastIndex) nodes.push(code.slice(lastIndex, match.index));
    lastIndex = match.index + text.length;

    if (comment) {
      nodes.push(span('cb-com', text, key++));
    } else if (string) {
      nodes.push(span('cb-str', text, key++));
    } else if (number) {
      nodes.push(span('cb-num', text, key++));
    } else if (call) {
      // A keyword before a paren is still a keyword: `if (`, `for (`.
      nodes.push(span(KEYWORDS.has(call) ? 'cb-kw' : 'cb-fn', text, key++));
    } else if (word) {
      if (KEYWORDS.has(word)) nodes.push(span('cb-kw', text, key++));
      // Capitalised bare words are types often enough to be worth it, and
      // harmless when they are not.
      else if (/^[A-Z]/.test(word)) nodes.push(span('cb-type', text, key++));
      else nodes.push(text);
    }
  }

  if (lastIndex < code.length) nodes.push(code.slice(lastIndex));

  return nodes;
}

function span(className: string, text: string, key: number): ReactNode {
  return (
    <span key={key} className={className}>
      {text}
    </span>
  );
}
