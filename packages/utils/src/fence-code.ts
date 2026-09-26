/**
 * Puts code fences around code that a model wrote without them.
 *
 * Questions come back with real newlines and correctly indented code, and no
 * ``` around it. Rendered as plain text the newlines collapse and the snippet
 * becomes one unreadable line; rendered as markdown the lines get joined into
 * a paragraph, which is no better. Either way the reader cannot see the code
 * they are being asked about.
 *
 * The right long-term fix is the prompt, which now demands fences. This exists
 * for everything already written, and as a safety net for the times a model
 * ignores the instruction — which it will.
 *
 * Deliberately conservative. A run of lines is treated as code only when it is
 * separated from the prose by blank lines and looks like code on the balance of
 * several signals. Prose wrongly fenced is worse than code left unfenced,
 * because prose in a code block is unreadable *and* looks like a bug.
 */

/**
 * Signals that a line is code rather than a sentence.
 *
 * Structural, not lexical. An earlier version looked for `function`, `const`
 * and `return` — and promptly fenced the sentence "a function declared with
 * the function keyword is hoisted, and a const is not", because prose about
 * code is full of the words code is made of. What prose does not do is end in
 * a brace or a semicolon, or sit indented under the line above it.
 */
const CODE_SIGNALS = [
  /[{};]$/, //                 ends in a brace or a semicolon
  /^\s{2,}\S/, //              indented under something
  /^\s*\/\//, //               a comment
  /\(.*\)$/, //                ends in a call's closing bracket
];

/**
 * Signals that a line is a sentence, whatever else it contains.
 *
 * Checked first and absolute. A sentence ends in punctuation that code does
 * not use at the end of a statement.
 */
const PROSE_SIGNALS = [/[.?:]$/];

function looksLikeCode(line: string): boolean {
  const trimmedEnd = line.trimEnd();
  if (trimmedEnd.trim().length === 0) return false;
  if (PROSE_SIGNALS.some((pattern) => pattern.test(trimmedEnd))) return false;

  return CODE_SIGNALS.some((pattern) => pattern.test(trimmedEnd));
}

/**
 * A block is code if most of it reads as code and it is more than one line.
 *
 * The majority test carries the lines a snippet contains that are not
 * distinctive alone — a bare `}` closing a function — without letting one
 * stray semicolon drag a paragraph in. The two-line floor stops a single
 * mention mid-sentence being torn out into a block of its own.
 */
function blockIsCode(lines: readonly string[]): boolean {
  const meaningful = lines.filter((line) => line.trim().length > 0);
  if (meaningful.length < 2) return false;

  const codeLines = meaningful.filter(looksLikeCode).length;

  return codeLines * 2 > meaningful.length;
}

export function fenceCode(text: string, language = 'js'): string {
  // Already fenced, even partly: leave it alone rather than nesting fences.
  if (text.includes('```')) return text;

  // Blocks are separated by blank lines, which is how these are written.
  const blocks = text.split(/\n{2,}/);
  if (blocks.length < 2) return text;

  const fenced = blocks.map((block) =>
    blockIsCode(block.split('\n')) ? `\`\`\`${language}\n${block.trimEnd()}\n\`\`\`` : block,
  );

  return fenced.join('\n\n');
}
