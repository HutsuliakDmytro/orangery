import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Markup and arithmetic; nothing here renders.
    environment: 'node',
    globals: true,
  },
})
