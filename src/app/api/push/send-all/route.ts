import { NextRequest } from 'next/server'
import { autorizarEnvio } from '../_auth'
import { enviarPushParaTodos } from '@/lib/push-server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const negado = await autorizarEnvio(request)
  if (negado) return negado

  const { titulo, descricao, link, tag } = await request.json().catch(() => ({}))

  if (!titulo) {
    return Response.json({ error: 'Título obrigatório' }, { status: 400 })
  }

  try {
    return Response.json(await enviarPushParaTodos({ titulo, descricao, link, tag }))
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
