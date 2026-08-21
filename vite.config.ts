import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // The Firebase SDK dwarfs the app code and changes far less often.
        // Splitting it out means an app-only change does not force everyone
        // to re-download ~180 kB of vendor bundle.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
