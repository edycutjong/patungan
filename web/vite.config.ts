import { resolve } from 'node:path'
import type { Connect } from 'vite'
import { defineConfig } from 'vite'

// `/` is the static landing page (index.html). The app is app.html, served for its routes.
// Vercel does the same with rewrites in vercel.json; this middleware covers `vite` and `vite preview`.
const APP_ROUTE = /^\/(p\/[^?#]*|new|verify|pools)\/?(?:[?#].*)?$/

const appRoutes: Connect.NextHandleFunction = (req, _res, next) => {
  if (req.url && APP_ROUTE.test(req.url)) req.url = '/app.html'
  next()
}

export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: { landing: resolve(import.meta.dirname, 'index.html'), app: resolve(import.meta.dirname, 'app.html') },
    },
  },
  plugins: [
    {
      name: 'patungan-app-routes',
      configureServer: (server) => void server.middlewares.use(appRoutes),
      configurePreviewServer: (server) => void server.middlewares.use(appRoutes),
    },
  ],
})
