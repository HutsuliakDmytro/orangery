import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Arithmetic and string building; nothing here renders.
    environment: 'node',
    globals: true,
  },
})
