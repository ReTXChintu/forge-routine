/**
 * Trims a JSON Schema down to the subset Gemini's `responseJsonSchema`
 * accepts.
 *
 * Its documented keyword list is: type, format, title, description, enum,
 * items, prefixItems, minItems, maxItems, minimum, maximum, anyOf, oneOf,
 * properties, additionalProperties, required — plus the non-standard
 * `propertyOrdering`. Anything else is not merely ignored: an unrecognised
 * keyword is rejected, so `$schema` alone — which `zodToJsonSchema` emits
 * at the root by default — is enough to fail every call.
 *
 * Narrower than the OpenAI strict transform and doing the opposite job.
 * That one *adds* constraints to make the vendor guarantee a shape; this
 * one *removes* constraints the vendor cannot express. Zod re-validates
 * afterwards either way, so what is dropped here is still enforced — just
 * on our side rather than theirs.
 */

const ALLOWED = new Set([
  'type',
  'format',
  'title',
  'description',
  'enum',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'anyOf',
  'oneOf',
  'properties',
  'additionalProperties',
  'required',
  'propertyOrdering',
  'nullable',
]);

/**
 * `format` values Gemini knows. A Zod `.email()` becomes
 * `format: "email"`, which is not among them and fails the request.
 */
const ALLOWED_FORMATS = new Set(['date-time', 'date', 'time', 'duration', 'enum']);

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return convert(schema) as Record<string, unknown>;
}

function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert);
  if (!isObject(node)) return node;

  const out: Json = {};

  for (const [key, value] of Object.entries(node)) {
    if (!ALLOWED.has(key)) continue;

    if (key === 'format') {
      if (typeof value === 'string' && ALLOWED_FORMATS.has(value)) out[key] = value;
      continue;
    }

    if (key === 'properties' && isObject(value)) {
      const properties: Json = {};
      for (const [name, child] of Object.entries(value)) properties[name] = convert(child);
      out[key] = properties;
      continue;
    }

    if (key === 'items' || key === 'additionalProperties') {
      // `additionalProperties: false` is a boolean and passes through; a
      // schema there is converted like any other node.
      out[key] = isObject(value) ? convert(value) : value;
      continue;
    }

    if (key === 'anyOf' || key === 'oneOf') {
      out[key] = Array.isArray(value) ? value.map(convert) : convert(value);
      continue;
    }

    out[key] = value;
  }

  // An object with properties but no `required` lets the model omit
  // everything, which defeats the point of declaring a schema. Zod's own
  // required set has already been encoded by the generator, so this only
  // fires for schemas that genuinely declared none.
  if (isObject(out['properties']) && out['required'] === undefined) {
    out['required'] = Object.keys(out['properties'] as Json);
  }

  return out;
}
