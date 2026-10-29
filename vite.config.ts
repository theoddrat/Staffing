import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ARTIFACT=1 builds the hosted (claude.ai artifact) variant: fonts inlined as data URIs because the
// host's CSP only serves fonts from Google Fonts or data:, output kept separate from dist/.
const artifact = process.env.ARTIFACT === '1';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  build: artifact
    ? { outDir: 'dist-artifact', emptyOutDir: true, assetsInlineLimit: (file: string) => (file.endsWith('.woff2') ? true : undefined) }
    : {},
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
} as any);
