import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: ['node 18'],
      dts: true,
      autoExternal: true,
      output: {
        minify: true,
      },
    },
    {
      format: 'cjs',
      syntax: ['node 18'],
      autoExternal: true,
      output: {
        minify: true,
      },
    },
  ],
});
