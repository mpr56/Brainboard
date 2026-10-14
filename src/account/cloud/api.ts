export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** A same-origin call to the Worker. Non-2xx becomes an ApiError carrying the server's message. */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status}).`)
  }
  return res
}

export const JSON_HEADERS = { 'Content-Type': 'application/json' }
