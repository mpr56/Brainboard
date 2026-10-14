import { fail } from './http'

export default {
  async fetch(): Promise<Response> {
    return fail(404, 'Not found.')
  },
} satisfies ExportedHandler<Env>
