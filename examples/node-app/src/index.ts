/**
 * Tiny library for the Rehearse node-app example.
 * The interesting bit isn't the code — it's the CI pipeline that runs it
 * across three Node versions in parallel.
 */
export function sum(a: number, b: number): number {
  return a + b;
}

export function uniqueWords(input: string): string[] {
  if (typeof input !== 'string') throw new TypeError('input must be a string');
  return Array.from(new Set(input.toLowerCase().match(/[a-z]+/g) ?? [])).sort();
}

export function asyncDelay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
