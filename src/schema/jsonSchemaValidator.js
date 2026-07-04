// Minimal, dependency-free validator supporting a small subset of JSON Schema
// (draft-07 style): `type` (string or array of strings, including "null"),
// `required`, `properties`, `items`, `enum`. This is intentionally not a full
// JSON Schema implementation (e.g. no $ref, no oneOf/anyOf, no format, no
// numeric ranges) - it only needs to validate this project's own schema in
// src/schema/bundleSchema.js. Pulling in a full validation library (e.g. ajv)
// was deferred rather than adopted by default, per CLAUDE.md's "no framework
// decisions locked in yet" guidance.

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value, typeSpec) {
  const allowed = Array.isArray(typeSpec) ? typeSpec : [typeSpec];
  return allowed.includes(typeOf(value));
}

export function validateAgainstSchema(schema, data, path = '$') {
  const errors = [];

  if (schema.type && !matchesType(data, schema.type)) {
    errors.push(`${path}: expected type ${JSON.stringify(schema.type)}, got "${typeOf(data)}"`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${path}: value ${JSON.stringify(data)} is not one of ${JSON.stringify(schema.enum)}`);
  }

  const isObjectSchema = matchesType(data, 'object') && (schema.properties || schema.required);
  if (isObjectSchema) {
    for (const key of schema.required ?? []) {
      if (!(key in data)) {
        errors.push(`${path}.${key}: missing required property`);
      }
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (key in data) {
        errors.push(...validateAgainstSchema(subSchema, data[key], `${path}.${key}`));
      }
    }
  }

  if (matchesType(data, 'array') && schema.items) {
    data.forEach((item, index) => {
      errors.push(...validateAgainstSchema(schema.items, item, `${path}[${index}]`));
    });
  }

  return errors;
}
