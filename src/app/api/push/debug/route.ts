import { execSync } from 'child_process'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function shellEnv(name: string): string {
  try {
    return execSync(`printenv ${name}`, { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

export async function GET() {
  const urlFromProcess = (globalThis.process?.env ?? {})['NEXT_PUBLIC_SUPABASE_URL'] || ''
  const urlFromShell = shellEnv('NEXT_PUBLIC_SUPABASE_URL')

  const serviceKeyProcess = (globalThis.process?.env ?? {})['SUPABASE_SERVICE_ROLE_KEY'] || ''
  const serviceKeyShell = shellEnv('SUPABASE_SERVICE_ROLE_KEY')

  const vapidPubProcess = (globalThis.process?.env ?? {})['NEXT_PUBLIC_VAPID_PUBLIC_KEY'] || ''
  const vapidPubShell = shellEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY')

  const vapidPrivProcess = (globalThis.process?.env ?? {})['VAPID_PRIVATE_KEY'] || ''
  const vapidPrivShell = shellEnv('VAPID_PRIVATE_KEY')

  const url = urlFromShell || urlFromProcess || '(vazio)'
  const key = serviceKeyShell || serviceKeyProcess || shellEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') || ''

  let dbTest = 'nao testado'
  if (key) {
    try {
      const supabase = createClient(url, key)
      const { data, error } = await supabase.from('push_subscriptions').select('id, tecnico_nome')
      if (error) dbTest = `erro: ${error.message}`
      else dbTest = `ok: ${(data || []).length} subscriptions`
    } catch (e: unknown) {
      dbTest = `exception: ${(e as Error).message}`
    }
  }

  return Response.json({
    process_env: {
      url_len: urlFromProcess.length,
      service_key_len: serviceKeyProcess.length,
      vapid_pub_len: vapidPubProcess.length,
      vapid_priv_len: vapidPrivProcess.length,
    },
    shell_env: {
      url_len: urlFromShell.length,
      service_key_len: serviceKeyShell.length,
      vapid_pub_len: vapidPubShell.length,
      vapid_priv_len: vapidPrivShell.length,
    },
    db_test: dbTest,
  })
}
