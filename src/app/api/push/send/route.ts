import { NextRequest } from 'next/server'
import { autorizarEnvio } from '../_auth'
import { enviarPushPara } from '@/lib/push-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const negado = await autorizarEnvio(request)
  if (negado) return negado

  const { tecnico_nome, titulo, descricao, link, tag } = await request.json().catch(() => ({}))

  if (!tecnico_nome || !titulo) {
    return Response.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  try {
    const resultado = await enviarPushPara([tecnico_nome], { titulo, descricao, link, tag }, { incluirAdmins: true })
    return Response.json(resultado)
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
