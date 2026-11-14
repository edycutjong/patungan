import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Connect } from 'vite'
import { defineConfig } from 'vitest/config'
import { pickVersion } from './src/version.ts'

// `/` is the static landing page (index.html). The app is app.html, served for its routes.
// Vercel does the same with rewrites in vercel.json; this middleware covers `vite` and `vite preview`.
const APP_ROUTE = /^\/(p\/[^?#]*|new|verify|pools)\/?(?:[?#].*)?$/

const appRoutes: Connect.NextHandleFunction = (req, _res, next) => {
  if (req.url && APP_ROUTE.test(req.url)) req.url = '/app.html'
  next()
}

// `/judge` is its own static page (judge.html); Vercel maps it with a rewrite.
const judgeRoute: Connect.NextHandleFunction = (req, _res, next) => {
  if (req.url && /^\/judge\/?(?:[?#].*)?$/.test(req.url)) req.url = '/judge.html'
  next()
}

// The release version for the `%PATUNGAN_VERSION%` slots (landing, /judge, the deck in public/pitch/). Build time only:
// hosted builds (vercel deploy uploads web/ without .git) pass the tag in PATUNGAN_VERSION, else the latest git tag,
// else package.json. src/version.ts explains why nothing fetches it at runtime.
function gitTag(): string | undefined {
  try {
    return execSync('git describe --tags --abbrev=0', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return undefined
  }
}
function buildVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')).version
  return pickVersion(process.env.PATUNGAN_VERSION, process.env.PATUNGAN_VERSION ? undefined : gitTag(), pkg)
}
const VERSION = buildVersion()
const stamp = (html: string) => html.replaceAll('%PATUNGAN_VERSION%', VERSION)

export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app.html'),
        judge: resolve(import.meta.dirname, 'judge.html'),
      },
    },
  },
  plugins: [
    {
      name: 'patungan-app-routes',
      configureServer: (server) => void server.middlewares.use(appRoutes).use(judgeRoute),
      configurePreviewServer: (server) => void server.middlewares.use(appRoutes).use(judgeRoute),
    },
    {
      name: 'patungan-version-stamp',
      transformIndexHtml: stamp,
      // public/ is copied verbatim, so the deck is stamped after the bundle is written.
      closeBundle() {
        const deck = resolve(import.meta.dirname, 'dist/pitch/index.html')
        try {
          writeFileSync(deck, stamp(readFileSync(deck, 'utf8')))
        } catch {
          // no deck in this build (e.g. vitest)
        }
      },
    },
  ],
  test: {
    // Unit tests only: web/e2e/ holds Playwright specs, which vitest must never collect.
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
})
