import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: ['node 18'],
      dts: true,
      output: {
        autoExternal: true,
        minify: true,
      },
    },
    {
      format: 'cjs',
      syntax: ['node 18'],
      output: {
        autoExternal: true,
        minify: true,
      },
    },
  ],
});
