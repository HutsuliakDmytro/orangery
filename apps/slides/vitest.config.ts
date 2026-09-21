import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // `tests/` holds Playwright e2e specs — those run via `pnpm test:e2e`.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.ts'],
    css: true,
    /**
     * The perf test builds a three-hundred-slide deck before it measures
     * anything, and several others zip and unzip a real package. Under the load
     * of the whole suite that crossed the five-second default often enough to
     * fail at random, which costs more than the time it saves.
     */
    testTimeout: 120_000,
  },
})
