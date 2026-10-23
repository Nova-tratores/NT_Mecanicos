// CARROS DA FROTA para o "Veículo utilizado" do relatório (José, 22/10/2026): foto, marca/modelo/placa para buscar,
// ficha para o ícone de informação e qual é o carro do técnico logado (Frota → vínculo do técnico).
// GET /api/frota-carros com "Authorization: Bearer <access token>". O técnico vem do banco pelo usuário do token.
import { NextRequest, NextResponse } from 'next/server'
import { exigirUsuario, supabaseAdmin } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'
type Rec = Record<string, unknown>

const sem = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
const soPlaca = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
/** "CAMINHAO - AQJ3H59" / "VOYAGE-SEB9J47" → "AQJ3H59" */
const placaDe = (s: unknown) => (String(s ?? '').toUpperCase().match(/[A-Z]{3}-?\d[A-Z\d]\d{2}/) || [''])[0].replace('-', '')
function mesmo(a: unknown, b: unknown) {
  const x = sem(a).split(/\s+/).filter((w) => w.length > 2), y = sem(b).split(/\s+/).filter((w) => w.length > 2)
  if (!x.length || !y.length) return false
  return x[0] === y[0] && (x[x.length - 1] === y[y.length - 1] || x.every((w) => y.includes(w)) || y.every((w) => x.includes(w)))
}

export async function GET(req: NextRequest) {
  // login pelo apiAuth: barra usuário inativo; nome do técnico pela mesma regra do /api/feed (José, 23/10/2026)
  const usu = await exigirUsuario(req); if (usu instanceof NextResponse) return usu
  const sb = supabaseAdmin()
  const tecnico = usu.nome

  const [fv, sp, pl, tv] = await Promise.all([
    sb.from('frota_veiculos').select('placa, marca, modelo, descricao, ano, ano_modelo, cor, combustivel, capacidade_tanque, tipo_veiculo, categoria, setor, id_placa, supa_placa_id')
      .eq('ativo', true).eq('tipo_registro', 'veiculo').order('placa'),
    sb.from('SupaPlacas').select('IdPlaca, NumPlaca'),
    sb.from('Placas').select('IdPlaca, NumPlaca, imagem_url, modelo'),
    sb.from('tecnico_veiculos').select('tecnico_nome, placa'),
  ])
  if (fv.error) return NextResponse.json({ error: fv.error.message }, { status: 500 })
  const supa = new Map(((sp.data || []) as Rec[]).map((s) => [Number(s.IdPlaca), String(s.NumPlaca)]))
  const supaPorPlaca = new Map(((sp.data || []) as Rec[]).map((s) => [placaDe(s.NumPlaca), String(s.NumPlaca)]))
  const placas = (pl.data || []) as Rec[]
  const fotoPorId = new Map(placas.filter((p) => p.imagem_url).map((p) => [Number(p.IdPlaca), String(p.imagem_url)]))
  const fotoPorPlaca = new Map(placas.filter((p) => p.imagem_url).map((p) => [placaDe(p.NumPlaca), String(p.imagem_url)]))
  const tecnicoDoCarro = new Map<string, string>()
  for (const t of (tv.data || []) as Rec[]) if (t.placa) tecnicoDoCarro.set(soPlaca(t.placa), String(t.tecnico_nome || ''))

  const carros = ((fv.data || []) as Rec[]).map((v) => {
    const placa = soPlaca(v.placa)
    // o relatório grava o NumPlaca do cadastro antigo (SupaPlacas) — o portal lê assim
    const numPlaca = supa.get(Number(v.supa_placa_id)) || supaPorPlaca.get(placa) || `${String(v.descricao || v.modelo || 'VEICULO').toUpperCase()} - ${placa}`
    return {
      placa, numPlaca,
      marca: (v.marca as string) || null, modelo: (v.modelo as string) || null, descricao: (v.descricao as string) || null,
      ano: v.ano ?? null, anoModelo: v.ano_modelo ?? null, cor: (v.cor as string) || null, combustivel: (v.combustivel as string) || null,
      tanque: v.capacidade_tanque ?? null, tipo: (v.tipo_veiculo as string) || (v.categoria as string) || null, setor: (v.setor as string) || null,
      foto: fotoPorId.get(Number(v.id_placa)) || fotoPorPlaca.get(placa) || null,
      tecnico: tecnicoDoCarro.get(placa) || null,
    }
  })
  const meu = tecnico ? carros.find((c) => c.tecnico && mesmo(c.tecnico, tecnico)) || null : null
  return NextResponse.json({ tecnico, meu: meu?.numPlaca || null, carros })
}
