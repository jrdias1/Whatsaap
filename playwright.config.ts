import { defineConfig } from '@playwright/test'

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://clinic:clinic_dev_only@localhost:5434/clinic_browser_validation?schema=public'
const jwtSecret = 'browser-e2e-local-secret-at-least-32-characters'
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 3002)
const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 5173)
const webUrl = `http://localhost:${webPort}`
const apiUrl = `http://localhost:${apiPort}`

// Browser specs that make direct API calls use the same isolated ports as webServer.
process.env.PLAYWRIGHT_API_URL = apiUrl
process.env.PLAYWRIGHT_WEB_URL = webUrl

process.env.DATABASE_URL = databaseUrl
process.env.JWT_ACCESS_SECRET = jwtSecret

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: webUrl,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: [
    {
      command: 'npm run start:prod --workspace api',
      url: `${apiUrl}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PLAYWRIGHT_TEST_TRUST_PROXY: '1',
        DATABASE_URL: databaseUrl,
        JWT_ACCESS_SECRET: jwtSecret,
        INTEGRATION_ENCRYPTION_KEY: 'd'.repeat(64),
        API_PORT: String(apiPort),
        WEB_ORIGIN: webUrl,
        WEB_APP_URL: webUrl,
        PUBLIC_APP_URL: webUrl,
        REDIS_URL: 'redis://localhost:6380/15',
        OUTBOX_DISPATCH_MODE: 'dry-run',
        LOCAL_INVITATION_HANDOFF: '1',
      },
    },
    {
      command: `npm run dev --workspace web -- --host localhost --port ${webPort}`,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: apiUrl },
    },
  ],
})
