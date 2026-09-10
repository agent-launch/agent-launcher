import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    isolate: true
  }
})
