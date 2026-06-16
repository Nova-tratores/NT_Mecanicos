import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

export async function POST(req: NextRequest) {
  try {
    const { data: opas } = await supabase
      .from('portal_opas')
      .select('id, titulo, descricao, created_at')
      .eq('status', 'aberto')

    if (!opas?.length) return NextResponse.json({ escaladas: 0 })

    const { data: tecnicos } = await supabase
      .from('mecanico_usuarios')
      .select('tecnico_nome')
      .eq('ativo', true)

    if (!tecnicos?.length) return NextResponse.json({ escaladas: 0 })

    const nomes = tecnicos.map(t => t.tecnico_nome).filter(Boolean)
    const agora = Date.now()
    let totalCriadas = 0

    for (const opa of opas) {
      const criadoEm = new Date(opa.created_at).getTime()
      const diasAberto = (agora - criadoEm) / (1000 * 60 * 60 * 24)

      for (const dia of [1, 2]) {
        if (diasAberto < dia) continue

        const tipo = `opa_dia${dia}`

        const { data: existente } = await supabase
          .from('mecanico_ocorrencias')
          .select('id')
          .eq('tipo', tipo)
          .eq('id_ordem', opa.id)
          .limit(1)

        if (existente?.length) continue

        const rows = nomes.map(nome => ({
          tecnico_nome: nome,
          tipo,
          descricao: `OPA "${opa.titulo}" não resolvida há ${dia} dia(s).\n${opa.descricao || ''}`.trim(),
          pontos: dia === 1 ? -3 : -5,
          data_referencia: new Date().toISOString().slice(0, 10),
          id_ordem: opa.id,
          admin_nome: 'Sistema',
        }))

        const { error } = await supabase.from('mecanico_ocorrencias').insert(rows)
        if (!error) {
          totalCriadas += rows.length

          await supabase.from('mecanico_notificacoes').insert(
            nomes.map(nome => ({
              tecnico_nome: nome,
              tipo: 'ocorrencia',
              titulo: `Ocorrência: OPA não resolvida`,
              descricao: `"${opa.titulo}" - ${dia} dia(s) sem resolução`,
              link: '/opa',
              lida: false,
            }))
          )

          const baseUrl = new URL(req.url).origin
          fetch(`${baseUrl}/api/push/send-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              titulo: `Ocorrência: OPA não resolvida`,
              descricao: `"${opa.titulo}" - ${dia} dia(s) sem resolução`,
              link: '/opa',
            }),
          }).catch(() => {})
        }
      }
    }

    return NextResponse.json({ escaladas: totalCriadas })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
