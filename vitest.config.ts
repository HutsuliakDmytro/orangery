import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // `tests/` holds Playwright e2e specs — those run via `pnpm test:e2e`.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.ts'],
    css: true,
    /**
     * A few tests unzip a real DOCX, write it out again and compare every part
     * byte for byte. That is seconds of work on its own, and under the load of
     * the whole suite it crossed the five-second default often enough to fail
     * at random — which costs more than the time it saves. A hang still fails,
     * it just has room to be a slow test first.
     */
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
    },
  },
})
