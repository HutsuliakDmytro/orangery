import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // ProseMirror needs a document to build a view against.
    environment: 'jsdom',
    globals: true,
  },
})
