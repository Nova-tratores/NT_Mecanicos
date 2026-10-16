import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/app/api/_lib/auth'
import { serverEnv } from '@/lib/server-env'

/**
 * Quem pode disparar notificação:
 * - usuário logado no app (Bearer da sessão), ou
 * - o Portal (servidor), com o header `x-push-secret` = PUSH_API_SECRET.
 *
 * Enquanto PUSH_API_SECRET não estiver configurada no Railway, as rotas
 * continuam abertas como antes (para o Portal não parar de notificar no deploy).
 * Configure a MESMA variável no app dos mecânicos e no Portal para fechar.
 */
export async function autorizarEnvio(req: NextRequest): Promise<NextResponse | null> {
  const segredo = serverEnv('PUSH_API_SECRET')
  if (!segredo) return null

  const recebido = req.headers.get('x-push-secret')
  if (recebido) {
    const a = Buffer.from(recebido)
    const b = Buffer.from(segredo)
    if (a.length === b.length && timingSafeEqual(a, b)) return null
  }

  const auth = await requireUser(req)
  return auth instanceof NextResponse ? auth : null
}
