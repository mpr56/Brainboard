/**
 * Gives everything `from` owns to `to`. Runs when an anonymous user signs in
 * with Google: Better Auth makes a new user for the Google account (or finds
 * the existing one) and then deletes the anonymous user, so the boards have to
 * move, or they would be orphaned.
 */
export async function moveOwnership(db: D1Database, from: string, to: string): Promise<void> {
  if (from === to) return
  await db.batch([
    db.prepare('update boards set owner_id = ?1 where owner_id = ?2').bind(to, from),
    db.prepare('update assets set owner_id = ?1 where owner_id = ?2').bind(to, from),
  ])
}
