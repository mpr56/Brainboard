import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('schema', () => {
  it('has the auth and app tables', async () => {
    const { results } = await env.DB.prepare("select name from sqlite_master where type = 'table'").all<{ name: string }>()
    const names = results.map((r) => r.name)
    for (const t of ['user', 'session', 'account', 'verification', 'boards', 'assets']) expect(names).toContain(t)
  })
})
