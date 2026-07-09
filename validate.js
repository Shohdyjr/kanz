/**
 * Minimal schema validation — avoids a heavy Zod/Joi dependency while still
 * giving every route a single source of truth for its expected shape.
 *
 * Usage:
 *   const { ok, errors } = validate(req.body, {
 *     date:      { type: "string", match: /^\d{4}-\d{2}-\d{2}$/ },
 *     amountUsd: { type: "number", finite: true, nonzero: true },
 *     note:      { type: "string", optional: true, maxLength: 200 },
 *   });
 *   if (!ok) return res.json({ ok: false, error: errors[0] });
 */

/**
 * @param {unknown} body
 * @param {Record<string, {
 *   type?: "string"|"number"|"boolean",
 *   optional?: boolean,
 *   match?: RegExp,
 *   minLength?: number,
 *   maxLength?: number,
 *   finite?: boolean,
 *   nonzero?: boolean,
 *   min?: number,
 *   max?: number,
 * }>} schema
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validate(body, schema) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["invalidBody"] };
  }
  const errors = [];
  for (const [key, rules] of Object.entries(schema)) {
    const val = body[key];
    const missing = val === undefined || val === null || val === "";
    if (missing) {
      if (!rules.optional) errors.push(`missing:${key}`);
      continue;
    }
    if (rules.type && typeof val !== rules.type) {
      errors.push(`type:${key}`);
      continue;
    }
    if (rules.match && typeof val === "string" && !rules.match.test(val)) {
      errors.push(`format:${key}`);
    }
    if (rules.minLength !== undefined && typeof val === "string" && val.length < rules.minLength) {
      errors.push(`tooShort:${key}`);
    }
    if (rules.maxLength !== undefined && typeof val === "string" && val.length > rules.maxLength) {
      errors.push(`tooLong:${key}`);
    }
    if (rules.finite && typeof val === "number" && !Number.isFinite(val)) {
      errors.push(`notFinite:${key}`);
    }
    if (rules.nonzero && typeof val === "number" && val === 0) {
      errors.push(`zero:${key}`);
    }
    if (rules.min !== undefined && typeof val === "number" && val < rules.min) {
      errors.push(`tooSmall:${key}`);
    }
    if (rules.max !== undefined && typeof val === "number" && val > rules.max) {
      errors.push(`tooBig:${key}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { validate };
