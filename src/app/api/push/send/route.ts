// Push para um técnico (José, 23/10/2026). Quem pode chamar:
//  - servidor (Portal, robôs): header "x-push-secret" = env PUSH_SECRET;
//  - usuário logado do app (ex.: Lousa avisa o técnico do lançamento).
// Enquanto PUSH_SECRET não estiver configurado no servidor, aceita sem login para não quebrar o Portal (aviso no log).
// QUANDO PUSH_SECRET EXISTIR no app: sem o header x-push-secret certo E sem login válido → 401. O Portal manda o
// header (src/lib/push-mecanicos.ts) se tiver o MESMO PUSH_SECRET no env dele (José, 23/10/2026).
// Não manda mais cópia para os admins (a gestão é no Portal). Casa o nome sem texto cru no filtro do banco.
import { NextResponse } from 'next/server'
import { exigirUsuario, segredoServidor } from '@/lib/apiAuth'
import { serverEnv } from '@/lib/server-env'
import { pushParaTecnico } from '@/lib/push-server'

export const dynamic = 'force-dynamic'

const linkSeguro = (l: unknown) => (typeof l === 'string' && /^\/(?!\/)/.test(l) ? l : '/')

export async function POST(request: Request) {
  if (!segredoServidor(request)) {
    if (serverEnv('PUSH_SECRET') || request.headers.get('authorization')) {
      const u = await exigirUsuario(request)
      if (u instanceof NextResponse) return u
    } else {
      console.warn('[push/send] chamada sem segredo — configure PUSH_SECRET no app e no Portal')
    }
  }
  const { tecnico_nome, titulo, descricao, link } = await request.json()
  if (!tecnico_nome || !titulo) return Response.json({ error: 'Dados inválidos' }, { status: 400 })

  const sent = await pushParaTecnico(String(tecnico_nome), {
    titulo: String(titulo).slice(0, 120),
    corpo: String(descricao || '').slice(0, 300),
    url: linkSeguro(link),
    baixar: false,
  })
  return Response.json({ sent })
}
