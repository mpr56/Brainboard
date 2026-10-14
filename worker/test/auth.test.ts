import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { moveOwnership } from '../src/ownership'
import { call, signIn } from './helpers'

describe('auth', () => {
  it('mints an anonymous user and a session cookie', async () => {
    const { cookie, userId } = await signIn()
    const res = await call('/api/auth/get-session', {}, cookie)
    const body = await res.json<{ user: { id: string; isAnonymous: boolean } }>()
    expect(body.user.id).toBe(userId)
    expect(body.user.isAnonymous).toBe(true)
  })

  it('keeps a session for 400 days, not the 7-day default', async () => {
    const { userId } = await signIn()
    const row = await env.DB.prepare('select "expiresAt" as e from session where "userId" = ?').bind(userId).first<{ e: string | number }>()
    const days = (new Date(row!.e).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(399)
  })
})

describe('moveOwnership', () => {
  it('hands every board and asset from one user to another', async () => {
    await env.DB.batch([
      env.DB.prepare("insert into boards (id, owner_id, title, created_at, opened_at) values ('mo1', 'anon', 't', 1, 1)"),
      env.DB.prepare("insert into boards (id, owner_id, title, created_at, opened_at) values ('mo2', 'other', 't', 1, 1)"),
      env.DB.prepare("insert into assets (id, owner_id, type, size) values ('ma1', 'anon', 'image/png', 1)"),
    ])
    await moveOwnership(env.DB, 'anon', 'google')
    const boards = await env.DB.prepare("select id, owner_id from boards where id in ('mo1','mo2') order by id").all()
    expect(boards.results).toEqual([
      { id: 'mo1', owner_id: 'google' },
      { id: 'mo2', owner_id: 'other' },
    ])
    const asset = await env.DB.prepare("select owner_id from assets where id = 'ma1'").first()
    expect(asset).toEqual({ owner_id: 'google' })
  })
})
