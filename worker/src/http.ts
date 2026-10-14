export const json = (data: unknown, init: ResponseInit = {}): Response => Response.json(data, init)

/** Every error the API returns has this one shape. */
export const fail = (status: number, message: string): Response => Response.json({ error: message }, { status })
