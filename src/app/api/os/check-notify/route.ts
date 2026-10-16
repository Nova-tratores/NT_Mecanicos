import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { enviarPushPara } from '@/lib/push-server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
)

/**
 * Rede de segurança chamada quando o app abre. O envio principal das OS novas
 * é feito pelo Portal (servidor) ao criar/atribuir a OS — funciona com o app fechado.
 */
export async function POST() {
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

    // O trigger antigo do banco grava o link com /preencher — considera os dois
    const links = recentOS.flatMap(os => [`/os/${os.Id_Ordem}`, `/os/${os.Id_Ordem}/preencher`])
    const { data: existing } = await supabase
      .from('mecanico_notificacoes')
      .select('tecnico_nome, link')
      .eq('tipo', 'nova_os')
      .in('link', links)

    const notifiedSet = new Set((existing || []).map(n => `${n.tecnico_nome}::${String(n.link).replace(/\/preencher$/, '')}`))

    let count = 0

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

        // Mesma tag do webhook: o celular mostra um aviso só, mesmo se os dois enviarem
        await enviarPushPara([tec], {
          titulo: `Nova OS #${os.Id_Ordem}`,
          descricao: `Cliente: ${cliente}`,
          link: `/os/${os.Id_Ordem}`,
          tag: `nova-os-${os.Id_Ordem}`,
        }).catch(() => {})

        count++
      }
    }

    return NextResponse.json({ notified: count })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
