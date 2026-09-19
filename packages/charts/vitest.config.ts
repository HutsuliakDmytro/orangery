import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    // Most of this is markup and arithmetic, but the renderer draws, so the
    // whole package runs in a DOM rather than splitting the suite in two.
    environment: 'jsdom',
    globals: true,
  },
})
