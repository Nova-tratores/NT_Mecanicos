import { readFileSync } from 'fs'

export const dynamic = 'force-dynamic'

export async function GET() {
  let procError = ''
  let procKeys: string[] = []
  try {
    const raw = readFileSync('/proc/1/environ', 'utf-8')
    const entries = raw.split('\0').filter(e => e.includes('='))
    procKeys = entries
      .map(e => e.split('=')[0])
      .filter(k => k.includes('SUPA') || k.includes('VAPID'))

    const getFromProc = (name: string) => {
      const entry = entries.find(e => e.startsWith(name + '='))
      return entry ? entry.slice(name.length + 1) : ''
    }

    return Response.json({
      source: '/proc/1/environ',
      proc_keys: procKeys,
      service_key_len: getFromProc('SUPABASE_SERVICE_ROLE_KEY').length,
      vapid_priv_len: getFromProc('VAPID_PRIVATE_KEY').length,
      vapid_pub_len: getFromProc('NEXT_PUBLIC_VAPID_PUBLIC_KEY').length,
    })
  } catch (e: unknown) {
    procError = (e as Error).message
  }

  return Response.json({
    source: 'fallback',
    proc_error: procError,
    process_env_keys: Object.keys(process.env).filter(k => k.includes('SUPA') || k.includes('VAPID')),
  })
}
