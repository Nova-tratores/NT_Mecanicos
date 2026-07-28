import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export async function GET() {
  let procEnv = ''
  try {
    procEnv = execSync("cat /proc/self/environ | tr '\\0' '\\n' | grep -E 'SUPA|VAPID|ROTAEXATA' || echo '(nada)'", { encoding: 'utf-8' }).trim()
  } catch { procEnv = '(erro)' }

  let envFiles = ''
  try {
    envFiles = execSync("ls -la /app/.env* 2>/dev/null || echo '(nenhum .env)'", { encoding: 'utf-8' }).trim()
  } catch { envFiles = '(erro)' }

  let allEnvCount = 0
  try {
    allEnvCount = Object.keys(process.env).length
  } catch {}

  const relevantKeys = Object.keys(process.env).filter(k =>
    k.includes('SUPA') || k.includes('VAPID') || k.includes('ROTA') || k.includes('OFICINA')
  )

  return Response.json({
    proc_environ: procEnv,
    env_files: envFiles,
    total_env_count: allEnvCount,
    relevant_keys: relevantKeys,
    node_version: process.version,
    cwd: process.cwd(),
  })
}
