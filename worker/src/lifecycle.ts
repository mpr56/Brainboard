import { getServerByName } from 'partyserver'

/** Everything that has to go when a board's row does, other than the row. */
export async function onBoardDeleted(env: Env, boardId: string): Promise<void> {
  const room = await getServerByName(env.BOARD_ROOM, boardId)
  await Promise.all([env.BUCKET.delete(`previews/${boardId}`), room.wipe()])
}
