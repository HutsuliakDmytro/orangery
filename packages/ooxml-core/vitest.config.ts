import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // No DOM here: this package is the zip and the XML, nothing that renders.
    environment: 'node',
    globals: true,
  },
})
