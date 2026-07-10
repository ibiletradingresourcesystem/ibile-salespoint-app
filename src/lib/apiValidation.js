/**
 * Input Validation & Sanitization for API Routes
 * 
 * Lightweight server-side validation for in-house POS.
 */

/**
 * Strip dangerous HTML/script patterns from a string
 */
export function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
}

/**
 * Recursively sanitize all string values in an object/array
 */
export function sanitizeBody(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeBody);
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeBody(value);
    }
    return sanitized;
  }
  return obj;
}

/**
 * Validate required fields and types against a schema.
 * 
 * Schema format:
 *   { fieldName: { required: true, type: 'string', maxLength: 200, min: 0, max: 999999 } }
 * 
 * Returns array of error strings, or null if valid.
 */
export function validateRequired(body, schema) {
  const errors = [];
  for (const [field, rules] of Object.entries(schema)) {
    const value = body[field];

    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`);
      continue;
    }

    if (value !== undefined && value !== null && value !== '') {
      if (rules.type === 'string' && typeof value !== 'string') {
        errors.push(`${field} must be a string`);
      } else if (rules.type === 'number' && typeof value !== 'number' && isNaN(Number(value))) {
        errors.push(`${field} must be a number`);
      } else if (rules.type === 'array' && !Array.isArray(value)) {
        errors.push(`${field} must be an array`);
      }

      if (rules.min !== undefined && Number(value) < rules.min) {
        errors.push(`${field} must be at least ${rules.min}`);
      }
      if (rules.max !== undefined && Number(value) > rules.max) {
        errors.push(`${field} must be at most ${rules.max}`);
      }
      if (rules.maxLength !== undefined && typeof value === 'string' && value.length > rules.maxLength) {
        errors.push(`${field} exceeds max length of ${rules.maxLength}`);
      }
    }
  }

  return errors.length > 0 ? errors : null;
}

/**
 * Validate a MongoDB ObjectId format
 */
export function isValidObjectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}
