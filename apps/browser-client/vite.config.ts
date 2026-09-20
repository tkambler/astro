import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  worker: { format: 'es' },
  plugins: [{
    name: 'strip-radix-client-directives',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/node_modules/@radix-ui/')) return
      // This build only targets browsers; React Server Components directives have no meaning here.
      return code.replace(/^(["'])use client\1;\s*/, '')
    },
  }, VitePWA({
    strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts',
    injectRegister: 'auto',
    manifest: { name: 'Astronote', short_name: 'Astronote', start_url: '/', display: 'standalone',
      background_color: '#ffffff', theme_color: '#f2f1ee',
      icons: [
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ] },
    injectManifest: { maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
      globPatterns: ['**/*.{js,css,html,wasm,data,svg,woff2}'] },
  })],
})
