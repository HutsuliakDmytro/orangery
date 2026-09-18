import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Nothing here touches a DOM; the pages are PNG buffers.
    environment: 'node',
    globals: true,
  },
})
