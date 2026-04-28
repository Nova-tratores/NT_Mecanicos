'use client'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { useCached } from '@/hooks/useCached'
import { supabase } from '@/lib/supabase'
import { ChevronRight, FileCheck, Send } from 'lucide-react'
import Link from 'next/link'

interface OsEnviada {
  id: number
  Ordem_Servico: string
  TecResp1: string
  Data: string
  TipoServico: string
  Status: string
  [key: string]: unknown
}

async function fetchOsEnviadas(nome: string): Promise<OsEnviada[]> {
  const { data } = await supabase
    .from('Ordem_Servico_Tecnicos')
    .select('*')
    .or(`TecResp1.ilike.%${nome}%,TecResp2.ilike.%${nome}%`)
    .eq('Status', 'enviado')
    .order('Data', { ascending: false })
  return (data || []) as OsEnviada[]
}

export default function OsEnviadas() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const { data: ordens, loading, refreshing } = useCached<OsEnviada[]>(
    `os-enviadas:${nome}`,
    () => fetchOsEnviadas(nome),
    { skip: !user },
  )

  return (
    <div>
      {refreshing && <div className="refresh-bar" />}

      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#C41E2A', margin: '0 0 20px' }}>
        OS Enviadas
      </h1>

      <div style={{ fontSize: 16, fontWeight: 700, color: '#1F2937', marginBottom: 12 }}>
        Enviadas ({ordens?.length || 0})
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : !ordens || ordens.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: 18, padding: 48, textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, background: '#F3F4F6',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <Send size={36} color="#D1D5DB" />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>
            Nenhuma OS enviada
          </div>
          <div style={{ fontSize: 14, color: '#9CA3AF' }}>
            Suas ordens de servico enviadas aparecerao aqui
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ordens.map((os) => (
            <Link key={os.id ?? os.Ordem_Servico} href={`/os-enviadas/${os.Ordem_Servico}`} style={{
              background: '#fff', borderRadius: 16, padding: '16px 14px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              borderLeft: '5px solid #10B981',
              textDecoration: 'none', color: 'inherit',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: '#D1FAE510',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <FileCheck size={22} color="#10B981" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#C41E2A' }}>{os.Ordem_Servico}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                    background: '#D1FAE5', color: '#059669',
                  }}>
                    Enviada
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {os.TecResp1}
                </div>
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                  {os.TipoServico} {os.Data ? ` - ${new Date(os.Data).toLocaleDateString('pt-BR')}` : ''}
                </div>
              </div>
              <ChevronRight size={20} color="#D1D5DB" style={{ flexShrink: 0 }} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
