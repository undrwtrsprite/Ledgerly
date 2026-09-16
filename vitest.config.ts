import { defineConfig } from 'vitest/config'

// App tests live in src/ and electron/. agent/skills tests use the
// node:test runner and must not be picked up by vitest.
export default defineConfig({
  test: {
    exclude: ['agent/**', 'node_modules/**', 'dist/**', 'release/**'],
  },
})
