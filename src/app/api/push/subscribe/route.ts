import { NextResponse } from 'next/server'
import { exigirUsuario, supabaseAdmin } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

// Inscrição de push: o nome do técnico vem do token, não da tela (José, 23/10/2026)
export async function POST(request: Request) {
  const u = await exigirUsuario(request)
  if (u instanceof NextResponse) return u
  if (!u.nome) return Response.json({ error: 'técnico não encontrado' }, { status: 404 })
  const { subscription } = await request.json()

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return Response.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const { endpoint, keys } = subscription

  const { error } = await supabaseAdmin()
    .from('push_subscriptions')
    .upsert(
      {
        tecnico_nome: u.nome,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      { onConflict: 'endpoint' },
    )

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}

// Sair do app (José, 23/10/2026): apaga a inscrição deste aparelho pelo endpoint, antes do celular desinscrever.
// Chamado por limparDadosDoAparelho() (lib/sessao.ts). Exige login, mas não confere o dono: o endpoint só existe
// no próprio aparelho, e na troca de técnico quem chama já é o novo login apagando a inscrição do anterior.
export async function DELETE(request: Request) {
  const u = await exigirUsuario(request)
  if (u instanceof NextResponse) return u
  const body = await request.json().catch(() => ({}))
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : ''
  if (!endpoint || !endpoint.startsWith('https://')) return Response.json({ error: 'endpoint inválido' }, { status: 400 })
  const { error } = await supabaseAdmin().from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
