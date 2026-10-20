import { test as base, expect, type BrowserContext, type Page, type Route } from '@playwright/test'
import { createHash } from 'node:crypto'

/**
 * Playwright runs against the real API limiter. Give each spec a distinct
 * loopback client address so independent test accounts do not share the
 * production IP throttle bucket. The application and limiter stay unchanged.
 */
export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    await isolateTestClient(context, testInfo.file)
    await use(context)
  },
})

export async function isolateTestClient(context: BrowserContext, file: string) {
    const bucket = createHash('sha256').update(file).digest().readUInt32BE(0) % 254 + 1
    const clientAddress = `192.0.2.${bucket}`
    const apiPort = process.env.PLAYWRIGHT_API_PORT ?? '3002'
    await context.route('**/*', async (route: Route) => {
      const url = new URL(route.request().url())
      const headers = route.request().headers()
      if (url.hostname === 'localhost' && url.port === apiPort) headers['x-forwarded-for'] = clientAddress
      await route.continue({ headers })
    })
}

export { expect, type Page }
