import { readFileSync } from 'fs'

let _cache: Record<string, string> | null = null

export function serverEnv(name: string): string {
  const fromProcess = process.env[name]
  if (fromProcess) return fromProcess

  if (!_cache) {
    _cache = {}
    try {
      const raw = readFileSync('/proc/1/environ', 'utf-8')
      for (const entry of raw.split('\0')) {
        const idx = entry.indexOf('=')
        if (idx > 0) {
          _cache[entry.slice(0, idx)] = entry.slice(idx + 1)
        }
      }
    } catch {}
  }

  return _cache[name] || ''
}
