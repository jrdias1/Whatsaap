import { defineConfig } from '@playwright/test'

const databaseUrl = 'postgresql://clinic:clinic_dev_only@localhost:5434/clinic_browser_validation?schema=public'
const jwtSecret = 'first-login-browser-local-secret-at-least-32'

process.env.DATABASE_URL = databaseUrl
process.env.JWT_ACCESS_SECRET = jwtSecret
process.env.INTEGRATION_ENCRYPTION_KEY = 'd'.repeat(64)

export default defineConfig({
  testDir: './browser-tests',
  testMatch: 'first-login-password.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  webServer: [
    {
      command: 'npm run start:prod --workspace api',
      url: 'http://localhost:3012/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PLAYWRIGHT_TEST_TRUST_PROXY: '1',
        DATABASE_URL: databaseUrl,
        JWT_ACCESS_SECRET: jwtSecret,
        INTEGRATION_ENCRYPTION_KEY: 'd'.repeat(64),
        API_PORT: '3012',
        WEB_ORIGIN: 'http://localhost:5174',
        WEB_APP_URL: 'http://localhost:5174',
        PUBLIC_APP_URL: 'http://localhost:5174',
        REDIS_URL: 'redis://localhost:6380',
        OUTBOX_DISPATCH_MODE: 'dry-run',
        LOCAL_INVITATION_HANDOFF: '1',
      },
    },
    {
      command: 'npm run dev --workspace web -- --host localhost --port 5174',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: 'http://localhost:3012' },
    },
  ],
})
