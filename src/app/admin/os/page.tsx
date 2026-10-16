'use client'
import { useEffect, useState } from 'react'
import { fetchAll } from '@/lib/supabase'
import type { OrdemServico } from '@/lib/types'
import { Search, Wrench, MapPin, User, Package, FileText } from 'lucide-react'
import Link from 'next/link'

const STATUS_COLORS: Record<string, string> = {
  'Orcamento': '#3B82F6',
  'Execucao': '#F59E0B',
  'Execucao Procurando pecas': '#F97316',
  'Executada aguardando comercial': '#8B5CF6',
  'Aguardando ordem Tecnico': '#0EA5E9',
  'Concluida': '#10B981',
  'Cancelada': '#EF4444',
  // Grafias com acento (como em FASES_OS) — antes caíam no cinza padrão
  'Orçamento': '#3B82F6',
  'Execução': '#F59E0B',
  'Execução Procurando peças': '#F97316',
  'Aguardando ordem Técnico': '#0EA5E9',
  'Concluída': '#10B981',
}

interface ReqResumo {
  id: number
  titulo: string
  valor_despeza: string | null
  ordem_servico: string | null
}

interface RelatorioResumo {
  Ordem_Servico: string
  Status: string
  pdf_criado: boolean
}

export default function OSListPage() {
  const [ordens, setOrdens] = useState<OrdemServico[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('')
  const [tecnicoFiltro, setTecnicoFiltro] = useState<string>('todos')
  const [tecnicos, setTecnicos] = useState<string[]>([])
  const [mostrarConcluidas, setMostrarConcluidas] = useState(false)
  const [reqMap, setReqMap] = useState<Record<string, ReqResumo[]>>({})
  const [relMap, setRelMap] = useState<Record<string, RelatorioResumo>>({})

  useEffect(() => {
    const carregar = async () => {
      try {
        // Paginado: Requisicao e Ordem_Servico_Tecnicos passam de 1000 linhas
        // (o limite do PostgREST escondia badges de requisição/relatório)
        const [list, reqData, relData] = await Promise.all([
          fetchAll<OrdemServico>('Ordem_Servico', {
            order: { column: 'Id_Ordem', ascending: false },
          }),
          fetchAll<ReqResumo>('Requisicao', {
            select: 'id, titulo, valor_despeza, ordem_servico',
            filters: (q) => q.not('ordem_servico', 'is', null),
            order: { column: 'id' },
          }),
          fetchAll<RelatorioResumo>('Ordem_Servico_Tecnicos', {
            select: 'Ordem_Servico, Status, pdf_criado',
          }),
        ])

        setOrdens(list)

        // Mapear requisições por OS
        const rmap: Record<string, ReqResumo[]> = {}
        for (const r of reqData) {
          if (r.ordem_servico) {
            if (!rmap[r.ordem_servico]) rmap[r.ordem_servico] = []
            rmap[r.ordem_servico].push(r)
          }
        }
        setReqMap(rmap)

        // Mapear relatórios por OS (prioriza o enviado/com PDF quando há mais de um)
        const rlmap: Record<string, RelatorioResumo> = {}
        for (const r of relData) {
          const atual = rlmap[r.Ordem_Servico]
          if (!atual || r.Status === 'enviado' || r.pdf_criado) rlmap[r.Ordem_Servico] = r
        }
        setRelMap(rlmap)

        const nomes = [...new Set(list.flatMap((o) => [o.Os_Tecnico, o.Os_Tecnico2].filter(Boolean)))].sort()
        setTecnicos(nomes)
      } catch (e) {
        console.error('[admin/os]', e)
      } finally {
        setLoading(false)
      }
    }
    carregar()
  }, [])

  const filtered = ordens.filter((o) => {
    if (!mostrarConcluidas && ['Concluida', 'Concluída', 'Cancelada'].includes(o.Status)) return false
    if (tecnicoFiltro !== 'todos' && o.Os_Tecnico !== tecnicoFiltro && o.Os_Tecnico2 !== tecnicoFiltro) return false
    if (!filtro) return true
    const term = filtro.toLowerCase()
    return String(o.Id_Ordem ?? '').toLowerCase().includes(term) ||
      o.Os_Cliente?.toLowerCase().includes(term) ||
      o.Projeto?.toLowerCase().includes(term) ||
      o.Os_Tecnico?.toLowerCase().includes(term)
  })

  return (
    <div>
      <style>{`
        @keyframes pulse-badge {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .badge-pulse {
          animation: pulse-badge 1.5s ease-in-out infinite;
        }
        .tooltip-wrapper {
          position: relative;
          display: inline-flex;
        }
        .tooltip-wrapper .tooltip-content {
          display: none;
          position: absolute;
          bottom: calc(100% + 8px);
          left: 50%;
          transform: translateX(-50%);
          background: #1F2937;
          color: #fff;
          padding: 10px 14px;
          border-radius: 10px;
          font-size: 12px;
          line-height: 1.5;
          white-space: nowrap;
          z-index: 50;
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
          pointer-events: none;
        }
        .tooltip-wrapper .tooltip-content::after {
          content: '';
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 6px solid transparent;
          border-top-color: #1F2937;
        }
        .tooltip-wrapper:hover .tooltip-content {
          display: block;
        }
      `}</style>

      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E3A5F', marginBottom: 16 }}>Todas as Ordens</h1>

      {/* Filtro por tecnico */}
      <div style={{ marginBottom: 12 }}>
        <select
          value={tecnicoFiltro}
          onChange={(e) => setTecnicoFiltro(e.target.value)}
          style={{
            width: '100%', padding: '10px 14px', borderRadius: 10,
            border: '1.5px solid #E5E7EB', fontSize: 13, background: '#fff',
          }}
        >
          <option value="todos">Todos os tecnicos</option>
          {tecnicos.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={16} style={{ position: 'absolute', left: 14, top: 13, color: '#9CA3AF' }} />
        <input
          type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por OS, cliente, projeto ou tecnico..."
          style={{
            width: '100%', padding: '12px 12px 12px 40px', borderRadius: 12,
            border: '1.5px solid #E5E7EB', fontSize: 14, outline: 'none', background: '#fff',
          }}
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#6B7280', marginBottom: 16, cursor: 'pointer' }}>
        <input type="checkbox" checked={mostrarConcluidas} onChange={(e) => setMostrarConcluidas(e.target.checked)} />
        Mostrar concluidas/canceladas
      </label>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: 14, padding: 40, textAlign: 'center',
          color: '#9CA3AF', fontSize: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          Nenhuma ordem encontrada
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((os) => {
            const color = STATUS_COLORS[os.Status] || '#6B7280'
            const reqs = reqMap[os.Id_Ordem] || []
            const rel = relMap[os.Id_Ordem]
            const temReq = reqs.length > 0
            const temRelatorio = rel && (rel.Status === 'enviado' || rel.pdf_criado)

            return (
              <Link key={os.Id_Ordem} href={`/admin/os/${os.Id_Ordem}`} style={{
                background: '#fff', borderRadius: 14, padding: 16,
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                borderLeft: `4px solid ${color}`,
                textDecoration: 'none', color: 'inherit',
                position: 'relative',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F' }}>{os.Id_Ordem}</span>

                    {/* Badge de requisição - piscando */}
                    {temReq && (
                      <span className="tooltip-wrapper">
                        <span className="badge-pulse" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          background: '#FEF3C7', border: '1.5px solid #F59E0B',
                          borderRadius: 6, padding: '2px 7px',
                          fontSize: 10, fontWeight: 700, color: '#D97706',
                          cursor: 'default',
                        }}>
                          <Package size={11} />
                          {reqs.length}
                        </span>
                        <span className="tooltip-content" style={{ whiteSpace: 'pre-line' }}>
                          {reqs.map(r => {
                            const valor = r.valor_despeza ? ` — R$ ${r.valor_despeza}` : ''
                            return `Requisição #${r.id}: ${r.titulo}${valor}`
                          }).join('\n')}
                        </span>
                      </span>
                    )}

                    {/* Badge de relatório - piscando */}
                    {temRelatorio && (
                      <span className="tooltip-wrapper">
                        <span className="badge-pulse" style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          background: '#D1FAE5', border: '1.5px solid #10B981',
                          borderRadius: 6, padding: '2px 7px',
                          fontSize: 10, fontWeight: 700, color: '#059669',
                          cursor: 'default',
                          animationDelay: '0.5s',
                        }}>
                          <FileText size={11} />
                          PDF
                        </span>
                        <span className="tooltip-content">
                          Relatório técnico {rel.pdf_criado ? 'com PDF gerado' : 'enviado'}
                        </span>
                      </span>
                    )}
                  </div>

                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                    background: color + '18', color,
                  }}>
                    {os.Status}
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{os.Os_Cliente}</div>
                {os.Projeto && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Wrench size={12} /> {os.Projeto}
                  </div>
                )}
                {os.Endereco_Cliente && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={12} /> {os.Endereco_Cliente}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: '#9CA3AF' }}>
                  <span><User size={11} /> {os.Os_Tecnico}</span>
                  {os.Os_Tecnico2 && <span><User size={11} /> {os.Os_Tecnico2}</span>}
                  {os.Tipo_Servico && <span>{os.Tipo_Servico}</span>}
                  <span>R$ {Number(os.Valor_Total || 0).toFixed(2).replace('.', ',')}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
