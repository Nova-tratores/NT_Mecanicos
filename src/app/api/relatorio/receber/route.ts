import { NextResponse } from 'next/server'
import { exigirUsuario, usuarioPorId } from '@/lib/apiAuth'
import { usuarioDoTokenVencido } from '@/lib/tokenVencido'
import { receberRelatorio } from '@/lib/relatorioRecebido'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// O servidor grava o relatório do técnico (José, 12/11/2026). Aceita login vencido há até 30 dias:
// a assinatura do token prova quem é — o relatório não pode ficar preso no celular por causa do login.
export async function POST(request: Request) {
  let u = await exigirUsuario(request)
  let tokenVencido = false
  if (u instanceof NextResponse) {
    if (u.status !== 401) return u
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    const dono = token ? await usuarioDoTokenVencido(token) : null
    if (!dono) return u
    u = await usuarioPorId(dono.uid, dono.email)
    if (u instanceof NextResponse) return u
    tokenVencido = true
  }

  const body = await request.json().catch(() => null) as { payload?: Record<string, unknown> } | null
  const payload = body?.payload
  const os = typeof payload?.Ordem_Servico === 'string' ? payload.Ordem_Servico.trim() : ''
  if (!payload || !/^OS-\d+$/.test(os)) return NextResponse.json({ ok: false, erro: 'relatório sem número de OS' }, { status: 400 })

  const r = await receberRelatorio({
    os, payload, tecnicoNome: u.nome, nomes: u.nomes, isAdmin: u.isAdmin, userId: u.userId, tokenVencido,
  })
  // 200 mesmo quando não gravou: a cópia ficou guardada e o robô tenta de novo; o celular decide pelo "ok"
  return NextResponse.json({ ...r, tokenVencido })
}
