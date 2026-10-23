// Ocorrências do Opa sem resolver: agora rodam no servidor a cada 5 min (instrumentation.ts → lib/robos-servidor.ts).
// O app não chama mais esta rota (José, 23/10/2026). Fica só para rodar à mão: segredo do servidor ou admin.
import { NextRequest, NextResponse } from 'next/server'
import { exigirAdmin, segredoServidor } from '@/lib/apiAuth'
import { escalarOpas } from '@/lib/robos-servidor'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!segredoServidor(req)) { const adm = await exigirAdmin(req); if (adm instanceof NextResponse) return adm }
  try {
    return NextResponse.json({ resultado: await escalarOpas() || 'nada a fazer' })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
