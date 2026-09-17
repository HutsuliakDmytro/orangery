import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Detection reads `navigator`, so there has to be one.
    environment: 'jsdom',
    globals: true,
  },
})
