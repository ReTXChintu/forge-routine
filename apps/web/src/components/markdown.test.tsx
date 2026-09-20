import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Markdown } from './Markdown';

/**
 * Checked against real model output rather than invented markdown.
 *
 * The sample below is an actual tutor reply that rendered as literal
 * "```js" in the chat, which is what this component exists to fix.
 */
const REAL_REPLY = `Closures work because a function retains a direct reference to its lexical environment, not a static copy of the values within it.

1. Private State & Encapsulation:
Because variables declared inside a function cannot be accessed from the outside scope, returning an inner function creates a public API over hidden data.

\`\`\`js
function createCounter() {
  let count = 0; // Hidden from outside access
  return {
    increment: () => ++count,
    getCount: () => count
  };
}
\`\`\`

2. Event Listeners:
When attaching handlers, the callback retains access to the setup context.`;

describe('Markdown', () => {
  it('turns a fenced block into code, not literal backticks', () => {
    const { container } = render(<Markdown content={REAL_REPLY} />);

    expect(container.textContent).not.toContain('```');
    expect(container.querySelector('pre')).toBeTruthy();
    expect(container.querySelector('pre')!.textContent).toContain('function createCounter()');
  });

  it('keeps the prose outside the fence as prose', () => {
    const { container } = render(<Markdown content={REAL_REPLY} />);

    // The paragraph before the fence must not end up inside the <pre>.
    expect(container.querySelector('pre')!.textContent).not.toContain('lexical environment');
    expect(container.textContent).toContain('lexical environment');
  });

  it('labels the block with its language', () => {
    render(<Markdown content={REAL_REPLY} />);
    expect(screen.getByText('js')).toBeTruthy();
  });

  it('highlights keywords using the design system token classes', () => {
    const { container } = render(<Markdown content={'```js\nconst x = 1;\n```'} />);

    const keywords = [...container.querySelectorAll('.cb-kw')].map((node) => node.textContent);
    expect(keywords).toContain('const');
    expect(container.querySelector('.cb-num')?.textContent).toBe('1');
  });

  it('does not colour a language it cannot parse', () => {
    // Mis-colouring Python as JavaScript reads as a rendering bug.
    const { container } = render(<Markdown content={'```python\ndef f(): pass\n```'} />);

    expect(container.querySelector('.cb-kw')).toBeNull();
    expect(container.querySelector('pre')!.textContent).toContain('def f(): pass');
  });

  it('leaves a keyword inside a string alone', () => {
    const { container } = render(<Markdown content={'```js\nconst s = "const";\n```'} />);

    // Two `const`s in the source, one of them inside a string.
    expect([...container.querySelectorAll('.cb-kw')]).toHaveLength(1);
    expect(container.querySelector('.cb-str')?.textContent).toBe('"const"');
  });

  it('renders both kinds of list', () => {
    const { container } = render(<Markdown content={'- one\n- two\n\n1. first\n2. second'} />);

    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('renders inline code and bold', () => {
    const { container } = render(<Markdown content={'Use `let` for **mutable** bindings.'} />);

    expect(container.querySelector('code')?.textContent).toBe('let');
    expect(container.querySelector('strong')?.textContent).toBe('mutable');
  });

  it('closes an unterminated fence rather than dumping backticks', () => {
    // A reply cut off by max_tokens mid-block.
    const { container } = render(<Markdown content={'Here:\n```js\nconst a = 1;'} />);

    expect(container.textContent).not.toContain('```');
    expect(container.querySelector('pre')!.textContent).toContain('const a = 1;');
  });

  it('renders HTML in the source as text', () => {
    // Model output is third-party text. It must never become markup.
    const { container } = render(<Markdown content={'<img src=x onerror=alert(1)>'} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('refuses a link that is not http', () => {
    const { container } = render(<Markdown content={'[click](javascript:alert(1))'} />);

    expect(container.querySelector('a')).toBeNull();
  });

  it('keeps a real link', () => {
    const { container } = render(
      <Markdown content={'See [MDN](https://developer.mozilla.org/en-US/).'} />,
    );

    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://developer.mozilla.org/en-US/');
    expect(anchor?.getAttribute('rel')).toContain('noreferrer');
  });
});
