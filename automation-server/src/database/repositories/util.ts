export type Row = Record<string, unknown>;

export const nowIso = () => new Date().toISOString();
export const bool = (v: unknown) => v === 1 || v === true;
export const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
export const num = (v: unknown): number => Number(v ?? 0);

export function json<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Build "a = @a, b = @b" for an UPDATE from a patch object, mapping camelCase keys to columns. */
export function setClause(patch: Record<string, unknown>, columns: Record<string, string>): { sql: string; params: Record<string, unknown> } {
  const parts: string[] = [];
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const col = columns[key];
    if (!col || value === undefined) continue;
    parts.push(`${col} = @${key}`);
    params[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
  }
  return { sql: parts.join(', '), params };
}
