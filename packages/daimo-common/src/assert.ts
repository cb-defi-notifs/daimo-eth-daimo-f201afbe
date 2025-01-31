export function assert(condition: boolean, msg?: string): asserts condition {
  if (!condition) throw new Error(msg || "Assertion failed");
}

export function assertNotNull<T>(value: T | null | undefined, msg?: string): T {
  assert(value !== null && value !== undefined, msg);
  return value;
}

/** Used to compile-time check that switch statements are exhaustive, etc. */
export function assertUnreachable(_: never): never {
  throw new Error("Unreachable");
}
