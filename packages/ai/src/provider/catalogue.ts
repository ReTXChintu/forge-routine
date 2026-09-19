/**
 * What each vendor is called, and which models it defaults to.
 *
 * One place, because three different screens need the same answer: the
 * settings UI listing what can be chosen, the factory building a client,
 * and the operator reading the docs. Three copies of this list would
 * disagree within a month.
 */

export type AIVendor = 'OPENAI' | 'ANTHROPIC' | 'GEMINI';

export const AI_VENDORS: readonly AIVendor[] = ['OPENAI', 'ANTHROPIC', 'GEMINI'] as const;

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
