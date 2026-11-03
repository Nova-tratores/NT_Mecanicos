// "Li e entendi" do pop-up de ocorrência → grava a ciência no banco (sql/ocorrencias-ciencia.sql).
// Só o próprio técnico (ou admin) dá ciência na ocorrência dele. Sem a coluna: 503, o app segue
// lembrando só no celular.
import { NextRequest, NextResponse } from 'next/server'
import { exigirUsuario, ehDoUsuario, supabaseAdmin } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const u = await exigirUsuario(req)
  if (u instanceof NextResponse) return u
  const body = await req.json().catch(() => ({})) as { id?: unknown }
  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id inválido' }, { status: 400 })

  const sb = supabaseAdmin()
  const { data: oc, error } = await sb.from('mecanico_ocorrencias').select('id, tecnico_nome').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!oc) return NextResponse.json({ error: 'ocorrência não encontrada' }, { status: 404 })
  if (!ehDoUsuario(u, oc.tecnico_nome)) return NextResponse.json({ error: 'sem permissão' }, { status: 403 })

  const { error: upErr } = await sb.from('mecanico_ocorrencias')
    .update({ ciente_em: new Date().toISOString() })
    .eq('id', id).is('ciente_em', null)
  if (upErr) {
    const semColuna = /ciente_em/i.test(upErr.message || '')
    return NextResponse.json({ error: semColuna ? 'migração ocorrencias-ciencia pendente' : upErr.message }, { status: semColuna ? 503 : 500 })
  }
  return NextResponse.json({ ok: true })
}
