/**
 * Compile-time exhaustiveness check for discriminated unions: place at the
 * end of a switch as `default: return ensureExhausted(value)`. Narrowing
 * makes the call unreachable while every case is handled; a newly added
 * union member then fails the typecheck until its case is written.
 */
export function ensureExhausted(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}
