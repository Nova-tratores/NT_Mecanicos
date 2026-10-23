// Push para todos os técnicos inscritos (José, 23/10/2026). Quem pode chamar:
//  - servidor (Portal): header "x-push-secret" = env PUSH_SECRET;  - admin logado;
//  - técnico logado só para avisar Opa novo (link /opa…), que é o uso da tela do Opa no app.
// Enquanto PUSH_SECRET não estiver configurado no servidor, aceita sem login para não quebrar o Portal (aviso no log).
// QUANDO PUSH_SECRET EXISTIR no app: sem o header x-push-secret certo E sem login válido → 401. O Portal manda o
// header (src/lib/push-mecanicos.ts) se tiver o MESMO PUSH_SECRET no env dele (José, 23/10/2026).
import { NextResponse } from 'next/server'
import { exigirUsuario, segredoServidor } from '@/lib/apiAuth'
import { serverEnv } from '@/lib/server-env'
import { enviarPush, inscricoes } from '@/lib/push-server'

export const dynamic = 'force-dynamic'

const linkSeguro = (l: unknown) => (typeof l === 'string' && /^\/(?!\/)/.test(l) ? l : '/')

export async function POST(request: Request) {
  const { titulo, descricao, link } = await request.json()
  if (!titulo) return Response.json({ error: 'Título obrigatório' }, { status: 400 })
  const url = linkSeguro(link)

  if (!segredoServidor(request)) {
    if (serverEnv('PUSH_SECRET') || request.headers.get('authorization')) {
      const u = await exigirUsuario(request)
      if (u instanceof NextResponse) return u
      if (!u.isAdmin && !url.startsWith('/opa')) return Response.json({ error: 'sem permissão' }, { status: 403 })
    } else {
      console.warn('[push/send-all] chamada sem segredo — configure PUSH_SECRET no app e no Portal')
    }
  }

  const subs = await inscricoes()
  if (!subs.length) return Response.json({ sent: 0 })
  const sent = await enviarPush(subs, {
    titulo: String(titulo).slice(0, 120),
    corpo: String(descricao || '').slice(0, 300),
    url,
    baixar: false,
  })
  return Response.json({ sent, total_subs: subs.length })
}
