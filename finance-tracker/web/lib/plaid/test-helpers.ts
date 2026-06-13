import { vi } from 'vitest'

export interface QueryResult {
  data: unknown
  error: unknown
}

/** A chainable + awaitable Supabase query-builder stub. */
export function createQueryStub(result: QueryResult = { data: null, error: null }) {
  const stub = {} as Record<string, ReturnType<typeof vi.fn>> & {
    then: (resolve: (r: QueryResult) => unknown) => unknown
  }
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'order', 'limit']) {
    stub[method] = vi.fn(() => stub)
  }
  stub.single = vi.fn().mockResolvedValue(result)
  stub.maybeSingle = vi.fn().mockResolvedValue(result)
  // Make the builder awaitable for chains that don't end in .single().
  stub.then = (resolve) => resolve(result)
  return stub
}

/**
 * A fake Supabase client. `user` defaults to a signed-in user (pass `null` for
 * unauthenticated). `tables` maps a table name to a specific query stub; any
 * other table returns a fresh empty stub.
 */
export function createSupabaseMock(opts: {
  user?: { id: string } | null
  tables?: Record<string, ReturnType<typeof createQueryStub>>
} = {}) {
  const user = opts.user === undefined ? { id: 'user-1' } : opts.user
  const tables = opts.tables ?? {}
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn((table: string) => tables[table] ?? createQueryStub()),
  }
}
