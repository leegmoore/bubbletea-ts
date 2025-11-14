import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const fromTests = (...paths: string[]) => resolve(dir, ...paths);

export default defineConfig({
  test: {
    name: 'specs',
    globals: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/setupTests.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov']
    }
  },
  resolve: {
    alias: {
      '@bubbletea/tea/internal': fromTests('../tea/src/internal/index.ts'),
      '@bubbletea/tea': fromTests('../tea/src/index.ts')
    }
  }
});
