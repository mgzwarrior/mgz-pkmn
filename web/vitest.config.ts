import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Component/unit tests live under src/. Scope discovery there so Vitest's
    // default glob doesn't grab the Playwright specs in e2e/ (their *.spec.ts
    // names match) and choke on the @playwright/test runtime.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // The full suite runs across parallel workers in CI; under that
    // contention the event loop is saturated, so real timers fire late and
    // heavy renders (e.g. the baked national dex) overrun the stock 5s
    // budget. Give every test generous headroom — this only costs wall-clock
    // time when a test genuinely fails, which should be ~never (#387, #653).
    testTimeout: 15000,
    reporters: [
      'default',
      ['junit', { outputFile: 'junit.xml' }],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
