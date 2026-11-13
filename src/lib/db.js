/**
 * @typedef {{
 *   bind: (...values: unknown[]) => Statement,
 *   first: () => Promise<Record<string, unknown> | null>,
 *   all: () => Promise<{ results: Record<string, unknown>[] }>,
 *   run: () => Promise<unknown>,
 * }} Statement
 */

/** @typedef {{ prepare: (sql: string) => Statement, batch: (statements: Statement[]) => Promise<unknown> }} Database */

export {};
