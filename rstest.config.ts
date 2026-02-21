import { defineConfig } from '@rstest/core';
import { withRslibConfig } from '@rstest/adapter-rslib';

export default defineConfig({
  extends: withRslibConfig(),
  output: {
    externals: [/^@opentelemetry\//],
  },
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/index.ts',
        '**/*.interface.ts',
      ],
    },
  },
});
