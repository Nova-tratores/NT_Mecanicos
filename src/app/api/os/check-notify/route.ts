import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

export async function POST(req: NextRequest) {
  try {
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const { data: recentOS } = await supabase
      .from('Ordem_Servico')
      .select('Id_Ordem, Os_Tecnico, Os_Tecnico2, Os_Cliente')
      .gte('Data', ontem)
      .not('Status', 'in', '("Concluída","Cancelada","Concluida","cancelada")')
      .order('Id_Ordem', { ascending: false })
      .limit(50)

    if (!recentOS?.length) return NextResponse.json({ notified: 0 })

    const links = recentOS.map(os => `/os/${os.Id_Ordem}`)
    const { data: existing } = await supabase
      .from('mecanico_notificacoes')
      .select('tecnico_nome, link')
      .eq('tipo', 'nova_os')
      .in('link', links)

    const notifiedSet = new Set((existing || []).map(n => `${n.tecnico_nome}::${n.link}`))

    let count = 0
    const baseUrl = new URL(req.url).origin

    for (const os of recentOS) {
      const tecnicos = [os.Os_Tecnico, os.Os_Tecnico2].filter(Boolean)
      const cliente = os.Os_Cliente || 'Cliente'

      for (const tec of tecnicos) {
        if (notifiedSet.has(`${tec}::/os/${os.Id_Ordem}`)) continue

        await supabase.from('mecanico_notificacoes').insert({
          tecnico_nome: tec,
          tipo: 'nova_os',
          titulo: `Nova OS #${os.Id_Ordem}`,
          descricao: `Cliente: ${cliente}`,
          link: `/os/${os.Id_Ordem}`,
          lida: false,
        })

        fetch(`${baseUrl}/api/push/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tecnico_nome: tec,
            titulo: `Nova OS #${os.Id_Ordem}`,
            descricao: `Cliente: ${cliente}`,
            link: `/os/${os.Id_Ordem}`,
          }),
        }).catch(() => {})

        count++
      }
    }

    return NextResponse.json({ notified: count })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
