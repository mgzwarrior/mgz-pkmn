import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end suite config (#757 / #758).
 *
 * Drives a real browser through the production-shaped single unit: the
 * FastAPI service serving the built SPA at `/`, with auth disabled so runs
 * are deterministic (sentinel `default` user). `e2e/boot-api.sh` owns the
 * throwaway DB + cache so the suite never touches developer state.
 *
 * Unit/component tests live in Vitest; this is reserved for journeys that
 * cross the SPA↔API seam — the breaks mocked component tests can't catch.
 */
const PORT = Number(process.env.E2E_PORT ?? 8000)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // Fail the build on a stray `test.only` left in a committed spec.
  forbidOnly: !!process.env.CI,
  // The SPA↔API seam is the point; serialize to keep DB state legible.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bash e2e/boot-api.sh',
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_PORT: String(PORT) },
  },
})
