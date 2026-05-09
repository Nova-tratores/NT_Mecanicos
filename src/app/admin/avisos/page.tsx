'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAdmin } from '@/hooks/useAdmin'
import {
  Megaphone, Plus, X, Trash2, Eye, EyeOff, Send, Clock,
} from 'lucide-react'

interface Aviso {
  id: number
  titulo: string
  mensagem: string
  ativo: boolean
  prioridade: 'normal' | 'urgente'
  created_at: string
  expira_em: string | null
}

export default function AvisosPage() {
  const { admin } = useAdmin()
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [form, setForm] = useState({
    titulo: '',
    mensagem: '',
    prioridade: 'normal' as 'normal' | 'urgente',
    expira_em: '',
  })

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from('avisos_gerais')
      .select('*')
      .order('created_at', { ascending: false })
    setAvisos((data || []) as Aviso[])
    setLoading(false)
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const publicar = async () => {
    if (!form.titulo.trim() || !form.mensagem.trim()) {
      alert('Preencha titulo e mensagem')
      return
    }
    setSalvando(true)
    await supabase.from('avisos_gerais').insert({
      titulo: form.titulo.trim(),
      mensagem: form.mensagem.trim(),
      prioridade: form.prioridade,
      ativo: true,
      expira_em: form.expira_em || null,
      criado_por: admin?.tecnico_nome || 'Admin',
    })
    setForm({ titulo: '', mensagem: '', prioridade: 'normal', expira_em: '' })
    setMostrarForm(false)
    setSalvando(false)
    await carregar()
  }

  const toggleAtivo = async (aviso: Aviso) => {
    await supabase.from('avisos_gerais').update({ ativo: !aviso.ativo }).eq('id', aviso.id)
    await carregar()
  }

  const excluir = async (id: number) => {
    if (!confirm('Excluir este aviso permanentemente?')) return
    await supabase.from('avisos_gerais').delete().eq('id', id)
    await carregar()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 10,
    border: '1.5px solid #E5E7EB', fontSize: 14, outline: 'none',
    background: '#fff', boxSizing: 'border-box',
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1E3A5F', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Megaphone size={22} /> Avisos Gerais
        </h1>
        <button onClick={() => setMostrarForm(!mostrarForm)} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: mostrarForm ? '#6B7280' : '#1E3A5F', color: '#fff',
          border: 'none', borderRadius: 10, padding: '8px 14px',
          fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}>
          {mostrarForm ? <><X size={14} /> Cancelar</> : <><Plus size={14} /> Novo Aviso</>}
        </button>
      </div>

      <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 16 }}>
        Comunicados enviados para todos os tecnicos e usuarios do portal. O autor nao e exibido.
      </p>

      {/* Form novo aviso */}
      {mostrarForm && (
        <div style={{
          background: '#fff', borderRadius: 14, padding: 16, marginBottom: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '2px solid #1E3A5F',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1E3A5F', margin: '0 0 12px' }}>Publicar Aviso</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: '#6B7280', display: 'block', marginBottom: 4 }}>Titulo *</label>
              <input value={form.titulo} onChange={(e) => setForm(p => ({ ...p, titulo: e.target.value }))}
                placeholder="Ex: Reunião segunda-feira" style={inputStyle} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#6B7280', display: 'block', marginBottom: 4 }}>Mensagem *</label>
              <textarea value={form.mensagem} onChange={(e) => setForm(p => ({ ...p, mensagem: e.target.value }))}
                placeholder="Escreva o comunicado..." rows={4}
                style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 11, color: '#6B7280', display: 'block', marginBottom: 4 }}>Prioridade</label>
                <select value={form.prioridade} onChange={(e) => setForm(p => ({ ...p, prioridade: e.target.value as 'normal' | 'urgente' }))}
                  style={inputStyle}>
                  <option value="normal">Normal</option>
                  <option value="urgente">Urgente</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#6B7280', display: 'block', marginBottom: 4 }}>Expira em (opcional)</label>
                <input type="date" value={form.expira_em}
                  onChange={(e) => setForm(p => ({ ...p, expira_em: e.target.value }))}
                  style={inputStyle} />
              </div>
            </div>
            <button onClick={publicar} disabled={salvando} style={{
              padding: '12px 0', borderRadius: 10,
              background: salvando ? '#9CA3AF' : '#1E3A5F', color: '#fff',
              border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Send size={14} /> {salvando ? 'Publicando...' : 'Publicar Aviso'}
            </button>
          </div>
        </div>
      )}

      {/* Lista de avisos */}
      {avisos.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 48, background: '#fff', borderRadius: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <Megaphone size={40} color="#D1D5DB" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: 14, color: '#9CA3AF' }}>Nenhum aviso publicado</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {avisos.map((a) => {
            const expirado = a.expira_em && a.expira_em < new Date().toISOString().split('T')[0]
            return (
              <div key={a.id} style={{
                background: '#fff', borderRadius: 14, padding: '14px 16px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                borderLeft: `4px solid ${a.prioridade === 'urgente' ? '#DC2626' : '#1E3A5F'}`,
                opacity: !a.ativo || expirado ? 0.5 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#1E3A5F' }}>{a.titulo}</span>
                      {a.prioridade === 'urgente' && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                          background: '#FEE2E2', color: '#DC2626',
                        }}>URGENTE</span>
                      )}
                      {!a.ativo && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                          background: '#F3F4F6', color: '#6B7280',
                        }}>INATIVO</span>
                      )}
                      {expirado && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                          background: '#FEF3C7', color: '#92400E',
                        }}>EXPIRADO</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                      {new Date(a.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {a.expira_em && (
                        <span> — expira {new Date(a.expira_em + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => toggleAtivo(a)} title={a.ativo ? 'Desativar' : 'Ativar'} style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                    }}>
                      {a.ativo ? <Eye size={16} color="#10B981" /> : <EyeOff size={16} color="#9CA3AF" />}
                    </button>
                    <button onClick={() => excluir(a.id)} title="Excluir" style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                    }}>
                      <Trash2 size={16} color="#EF4444" />
                    </button>
                  </div>
                </div>
                <div style={{
                  fontSize: 13, color: '#374151', lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}>
                  {a.mensagem}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
