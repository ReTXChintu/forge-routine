/**
 * What each vendor is called, and which models it defaults to.
 *
 * One place, because three different screens need the same answer: the
 * settings UI listing what can be chosen, the factory building a client,
 * and the operator reading the docs. Three copies of this list would
 * disagree within a month.
 */

export type AIVendor = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'CLAUDE_CODE' | 'CODEX';

export const AI_VENDORS: readonly AIVendor[] = [
  'OPENAI',
  'ANTHROPIC',
  'GEMINI',
  'CLAUDE_CODE',
  'CODEX',
] as const;

export interface VendorProfile {
  id: AIVendor;
  label: string;
  /** Where a user goes to get a key. Shown next to the empty field. */
  keyUrl: string;
  /** API base. A property of the vendor, not of the deployment. */
  baseUrl: string;
  /** Recognisable start of a valid key, used for a client-side sanity check. */
  keyPrefix: string;
  /** Cheap, high-volume tier — hints, concept detail, evaluation prose. */
  defaultFast: string;
  /** The tier that has to reason — curriculum, review, interviews. */
  defaultReasoning: string;
  /** Null where the vendor has no embeddings endpoint. */
  defaultEmbedding: string | null;
  /** Said plainly in the UI, so the choice is not made blind. */
  note: string;
  /**
   * True where there is no key to paste, because credentials live elsewhere.
   *
   * Only Claude Code, which runs a CLI that is already signed in. The settings
   * screen reads this to stop asking for something that does not exist, and
   * the service reads it to allow a credential row without a key.
   */
  keyless?: boolean;
}

export const AI_VENDOR_PROFILES: Record<AIVendor, VendorProfile> = {
  OPENAI: {
    id: 'OPENAI',
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    keyPrefix: 'sk-',
    defaultFast: 'gpt-4o-mini',
    defaultReasoning: 'gpt-4o',
    defaultEmbedding: 'text-embedding-3-small',
    note: 'The only vendor here with an embeddings endpoint.',
  },
  ANTHROPIC: {
    id: 'ANTHROPIC',
    label: 'Claude',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    baseUrl: 'https://api.anthropic.com',
    keyPrefix: 'sk-ant-',
    defaultFast: 'claude-haiku-4-5',
    defaultReasoning: 'claude-opus-5',
    defaultEmbedding: null,
    note: 'No embeddings endpoint. Nothing in the product needs one yet.',
  },
  CLAUDE_CODE: {
    id: 'CLAUDE_CODE',
    label: 'Claude Code (local)',
    keyUrl: 'https://code.claude.com/docs/en/overview',
    // A process, not an endpoint. Kept non-empty so every profile reads the
    // same way; nothing dials it.
    baseUrl: 'local://claude-code',
    keyPrefix: '',
    keyless: true,
    defaultFast: 'haiku',
    defaultReasoning: 'opus',
    defaultEmbedding: null,
    note:
      'Runs the Claude Code CLI on this machine and answers as whoever it is signed in as, ' +
      'so there is no key to paste. Only available where the server itself runs — not on a ' +
      'remote deployment. Slower than the API, and every call carries Claude Code’s own ' +
      'context, so it suits the assistant better than bulk generation.',
  },
  CODEX: {
    id: 'CODEX',
    label: 'ChatGPT via Codex (local)',
    keyUrl: 'https://developers.openai.com/codex',
    baseUrl: 'local://codex',
    keyPrefix: '',
    keyless: true,
    // Codex has no command that lists the models a ChatGPT plan may use, so
    // rather than guess names this leaves the choice to Codex's own config.
    defaultFast: 'codex-default',
    defaultReasoning: 'codex-default',
    defaultEmbedding: null,
    note:
      'Runs the Codex CLI on this machine and answers as the ChatGPT account it is signed in as, ' +
      'so there is no key to paste. Only available where the server itself runs — not on a ' +
      'remote deployment. Slower than the API, so it suits the assistant better than bulk ' +
      'generation.',
  },
  GEMINI: {
    id: 'GEMINI',
    label: 'Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com',
    keyPrefix: 'AIza',
    defaultFast: 'gemini-2.5-flash',
    defaultReasoning: 'gemini-2.5-pro',
    defaultEmbedding: 'text-embedding-004',
    note: 'Has a free tier, which makes it the cheapest way to try generation.',
  },
};

export function isAIVendor(value: string): value is AIVendor {
  return (AI_VENDORS as readonly string[]).includes(value);
}
