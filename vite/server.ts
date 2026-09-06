import { normalizePath, type ServerOptions } from 'vite'

const WATCHED_MARKDOWN_ROOTS = ['/src/', '/packages/core/src/', '/packages/vue/src/']

function ignoreMarkdownOutsideSource(path: string): boolean {
  const normalized = normalizePath(path)
  if (!normalized.endsWith('.md')) return false
  return !WATCHED_MARKDOWN_ROOTS.some((root) => normalized.includes(root))
}

export const WATCH_IGNORED = [
  '**/desktop/**',
  '**/packages/cli/**',
  '**/packages/mcp/**',
  '**/packages/docs/**',
  '**/tests/**',
  '**/.worktrees/**',
  '**/.github/**',
  '**/.pi/**',
  ignoreMarkdownOutsideSource
]

export function createDevServerOptions(host: string | undefined): ServerOptions {
  const port = Number(process.env.VITE_PORT) || 1420
  return {
    port,
    strictPort: true,
    host: host || '127.0.0.1',
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: port + 1
        }
      : undefined,
    watch: {
      ignored: WATCH_IGNORED
    }
  }
}
