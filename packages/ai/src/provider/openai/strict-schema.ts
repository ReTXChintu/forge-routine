/**
 * Converts a Zod schema into one OpenAI's strict structured-output mode
 * accepts, and undoes the conversion on the way back.
 *
 * Why this exists: without `strict: true` the model is *asked* for a shape
 * and frequently returns something else. The provider then feeds the
 * validation errors back and asks again — a second billed call carrying the
 * entire first conversation plus the bad output. In our own telemetry that
 * repair fired on 23 of 23 evaluator calls. It is not an edge case, it is
 * the normal path, and it roughly doubles the bill.
 *
 * Strict mode removes the guesswork, but it imposes three rules that a Zod
 * schema does not naturally satisfy:
 *
 *   1. Every object must set `additionalProperties: false`.
 *   2. Every property must appear in `required` — there is no "optional".
 *   3. A long list of validation keywords is rejected outright.
 *
 * Rule 2 is the interesting one. An optional field has to be expressed as a
 * required field that may be `null`, which means the model now sends
 * `{"line": null}` where it used to send nothing at all — and a Zod
 * `.optional()` rejects an explicit null. So the conversion records which
 * properties were optional, and `stripAbsent` deletes exactly those keys
 * when they come back null, before validation runs.
 *
 * Only those. A field declared `.nullable()` keeps its null, because there
 * the null is the answer rather than the absence of one.
 */

/** Keywords strict mode rejects. Dropped rather than approximated. */
const UNSUPPORTED = new Set([
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'patternProperties',
  'propertyNames',
  'contains',
  'minContains',
  'maxContains',
  'unevaluatedItems',
  'unevaluatedProperties',
  'default',
  'examples',
  'dependentRequired',
]);

/**
 * Mirrors the schema's shape, marking where a `null` means "not provided".
 *
 * Parallel to the data rather than a list of paths: paths through arrays and
 * unions need wildcards, and a wildcard language is more to get wrong than a
 * tree that is walked alongside the value it describes.
 */
export interface AbsenceMap {
  /** Property names at this object that were optional before conversion. */
  optional?: string[];
  /** Per-property maps, for recursing into nested objects. */
  properties?: Record<string, AbsenceMap>;
  /** Map for every element of an array. */
  items?: AbsenceMap;
  /** Maps for each branch of a union. */
  branches?: AbsenceMap[];
}

export interface StrictConversion {
  schema: Record<string, unknown>;
  absence: AbsenceMap;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when the node already admits null — a deliberate `.nullable()`. */
function admitsNull(node: Json): boolean {
  if (node['nullable'] === true) return true;
  const type = node['type'];
  if (Array.isArray(type) && type.includes('null')) return true;
  const anyOf = node['anyOf'];
  return Array.isArray(anyOf) && anyOf.some((branch) => isObject(branch) && admitsNull(branch));
}

/** Widens a node so `null` is a legal value for it. */
function orNull(node: Json): Json {
  if (admitsNull(node)) return node;

  const type = node['type'];
  if (typeof type === 'string') return { ...node, type: [type, 'null'] };
  if (Array.isArray(type)) return { ...node, type: [...type, 'null'] };

  // No `type` to widen — an enum or a bare union. Wrap it instead.
  return { anyOf: [node, { type: 'null' }] };
}

/**
 * Rewrites one schema node, collecting the optional properties it drops.
 *
 * `$ref` is not handled because the caller generates with refs disabled;
 * a ref reaching here would be silently under-constrained, so it throws.
 */
function convert(node: unknown): { schema: unknown; absence: AbsenceMap } {
  if (!isObject(node)) return { schema: node, absence: {} };

  if ('$ref' in node) {
    throw new Error('strict-schema: $ref is not supported; generate with $refStrategy "none"');
  }

  const out: Json = {};
  const absence: AbsenceMap = {};

  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED.has(key)) continue;

    // `nullable: true` is OpenAPI's spelling. Strict mode wants the null in
    // the type itself, so it is translated rather than passed through.
    if (key === 'nullable') continue;

    if (key === 'properties' && isObject(value)) continue;
    if (key === 'required') continue;
    if (key === 'items') continue;
    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') continue;

    out[key] = value;
  }

  // -- objects --------------------------------------------------------------
  const properties = node['properties'];
  if (isObject(properties)) {
    const declaredRequired = new Set(
      Array.isArray(node['required']) ? (node['required'] as string[]) : [],
    );

    const converted: Json = {};
    const childAbsence: Record<string, AbsenceMap> = {};
    const wasOptional: string[] = [];

    for (const [name, child] of Object.entries(properties)) {
      const result = convert(child);
      let schema = result.schema as Json;

      if (!declaredRequired.has(name)) {
        // Optional becomes required-and-nullable. Recorded so the null can
        // be turned back into an absent key before Zod sees it.
        wasOptional.push(name);
        schema = orNull(schema);
      }

      converted[name] = schema;
      if (hasContent(result.absence)) childAbsence[name] = result.absence;
    }

    out['properties'] = converted;
    // Every property, in a stable order. Strict mode requires the full list.
    out['required'] = Object.keys(converted);
    out['additionalProperties'] = false;

    if (wasOptional.length > 0) absence.optional = wasOptional;
    if (Object.keys(childAbsence).length > 0) absence.properties = childAbsence;
  } else if (node['type'] === 'object') {
    // An object with no declared properties. Strict mode still wants both
    // keys present, and an empty object is the only thing it can now hold.
    out['properties'] = {};
    out['required'] = [];
    out['additionalProperties'] = false;
  }

  // -- arrays ---------------------------------------------------------------
  const items = node['items'];
  if (items !== undefined) {
    // Tuples would need per-position conversion and no agent schema uses one.
    if (Array.isArray(items)) {
      throw new Error('strict-schema: tuple `items` arrays are not supported');
    }
    const result = convert(items);
    out['items'] = result.schema;
    if (hasContent(result.absence)) absence.items = result.absence;
  }

  // -- unions ---------------------------------------------------------------
  // `oneOf` and `allOf` are rejected by strict mode; both collapse to anyOf,
  // which is a widening and so can only ever accept more than intended —
  // and Zod is still the authority on what is actually accepted.
  const union = node['anyOf'] ?? node['oneOf'] ?? node['allOf'];
  if (Array.isArray(union)) {
    const results = union.map((branch) => convert(branch));
    out['anyOf'] = results.map((result) => result.schema);
    const branches = results.map((result) => result.absence);
    if (branches.some(hasContent)) absence.branches = branches;
  }

  if (node['nullable'] === true) return { schema: orNull(out), absence };

  return { schema: out, absence };
}

function hasContent(map: AbsenceMap): boolean {
  return Boolean(map.optional ?? map.properties ?? map.items ?? map.branches);
}

/** Converts a JSON Schema into its strict-mode equivalent. */
export function toStrictSchema(schema: Record<string, unknown>): StrictConversion {
  const result = convert(schema);
  return { schema: result.schema as Record<string, unknown>, absence: result.absence };
}

/**
 * Deletes the nulls that strict mode forced the model to invent.
 *
 * Mutates a structure that was just parsed from the response body and is
 * owned by the caller; copying it would be honest and pointless.
 */
export function stripAbsent(value: unknown, absence: AbsenceMap): unknown {
  if (!hasContent(absence)) return value;

  if (Array.isArray(value)) {
    if (absence.items) {
      for (const element of value) stripAbsent(element, absence.items);
    }
    return value;
  }

  if (!isObject(value)) return value;

  for (const name of absence.optional ?? []) {
    if (value[name] === null) delete value[name];
  }

  for (const [name, child] of Object.entries(absence.properties ?? {})) {
    if (name in value) stripAbsent(value[name], child);
  }

  // A union: the branch that matched is unknown here, so every branch's
  // absences are applied. Harmless — a key that is null in one branch's
  // reading and meaningful in another cannot exist, since the property name
  // would have to be both optional and nullable in the same object.
  for (const branch of absence.branches ?? []) stripAbsent(value, branch);

  return value;
}
