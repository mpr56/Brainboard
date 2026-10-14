/** Everything that has to go when a board's row does, other than the row. */
export async function onBoardDeleted(env: Env, boardId: string): Promise<void> {
  await env.BUCKET.delete(`previews/${boardId}`)
}
