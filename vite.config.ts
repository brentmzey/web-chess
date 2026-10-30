import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

export default defineConfig({
  // Stamps the release version into the bundle so a deployed build can always be identified
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      onwarn(warning, warn) {
        // zod ships a /* @__PURE__ */ comment Rollup cannot place; it is dropped harmlessly
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules/zod')) return;
        warn(warning);
      },
      output: {
        manualChunks: {
          three: ['three'],
          chess: ['chess.js'],
          vendor: ['zod', 'tslog', 'dayjs']
        }
      }
    }
  },
  server: {
    port: 3000,
    open: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
