'use client'
import { useEffect, useState } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { Search, Download, Camera, X, Loader2, ChevronLeft, ChevronRight, WifiOff, RefreshCw } from 'lucide-react'

const CARREGAR_TIMEOUT = 12000
function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([Promise.resolve(p), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), CARREGAR_TIMEOUT))])
}

interface FotoItem {
  label: string
  url: string
  campo: string
}

interface ResultadoOS {
  ordemServico: string
  tecnico: string
  cliente: string
  data: string
  fotos: FotoItem[]
}

const FOTO_LABELS: Record<string, string> = {
  FotoHorimetro: 'Horimetro',
  FotoChassis: 'Chassis',
  FotoFrente: 'Frente',
  FotoDireita: 'Direita',
  FotoEsquerda: 'Esquerda',
  FotoTraseira: 'Traseira',
  FotoVolante: 'Volante',
  FotoFalha1: 'Falha 1',
  FotoFalha2: 'Falha 2',
  FotoFalha3: 'Falha 3',
  FotoFalha4: 'Falha 4',
  FotoPecaNova1: 'Peca Nova 1',
  FotoPecaNova2: 'Peca Nova 2',
  FotoPecaInstalada1: 'Peca Instalada 1',
  FotoPecaInstalada2: 'Peca Instalada 2',
  FotoAlmoco: 'Almoço',
}

const FOTO_CAMPOS = Object.keys(FOTO_LABELS)
const CAMPOS_SELECT = FOTO_CAMPOS.join(', ') + ', TecResp1, Data, Ordem_Servico'

function formatarData(d: string) {
  if (!d || d === '-') return '-'
  const [y, m, day] = d.slice(0, 10).split('-')
  if (!y || !m || !day) return d
  return `${day}/${m}/${y}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function montarResultados(registros: any[], clienteMap: Record<string, string>): ResultadoOS[] {
  return registros.map((rec) => {
    const fotos: FotoItem[] = []
    for (const campo of FOTO_CAMPOS) {
      const url = rec[campo] as string
      if (url && !url.startsWith('blob:')) {
        fotos.push({ label: FOTO_LABELS[campo], url, campo })
      }
    }
    return {
      ordemServico: String(rec.Ordem_Servico),
      tecnico: (rec.TecResp1 as string) || '-',
      cliente: clienteMap[String(rec.Ordem_Servico)] || '-',
      data: (rec.Data as string) || '-',
      fotos,
    }
  }).filter((r) => r.fotos.length > 0)
}

export default function FotosTecnicoPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [todos, setTodos] = useState<ResultadoOS[]>([])
  const [fotoAberta, setFotoAberta] = useState<FotoItem | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)
  const [osAberta, setOsAberta] = useState<string | null>(null)
  const [erroCarga, setErroCarga] = useState(false)
  const [tentativa, setTentativa] = useState(0)

  // Carregar todas as fotos do tecnico ao montar
  useEffect(() => {
    if (!nome) {
      // Perfil carregado mas sem nome: não prende no spinner
      if (!userLoading) setCarregando(false)
      return
    }
    let cancelado = false

    async function carregar() {
      setCarregando(true)
      setErroCarga(false)
      try {
      const { data: regs, error } = await withTimeout(supabase
        .from('Ordem_Servico_Tecnicos')
        .select(CAMPOS_SELECT)
        .or(`TecResp1.ilike.%${nome}%,TecResp2.ilike.%${nome}%`)
        .eq('Status', 'enviado')
        .order('Data', { ascending: false })
        .limit(200))

      if (cancelado) return
      if (error) throw error
      const registros = regs || []

      if (registros.length > 0) {
        const osIds = registros.map((r: any) => String(r.Ordem_Servico))
        const uniqueIds = [...new Set(osIds)]
        const { data: osData } = await withTimeout(supabase
          .from('Ordem_Servico')
          .select('Id_Ordem, Os_Cliente')
          .in('Id_Ordem', uniqueIds))

        if (cancelado) return
        const clienteMap: Record<string, string> = {}
        osData?.forEach((o: { Id_Ordem: string; Os_Cliente: string }) => {
          clienteMap[String(o.Id_Ordem)] = o.Os_Cliente || '-'
        })

        setTodos(montarResultados(registros, clienteMap))
      } else {
        setTodos([])
      }
      } catch {
        // Sem sinal: não dizer "nenhuma foto" — mostra aviso com "tentar de novo"
        if (!cancelado) setErroCarga(true)
      } finally {
        if (!cancelado) setCarregando(false)
      }
    }

    carregar()
    const onOnline = () => setTentativa(t => t + 1)
    window.addEventListener('online', onOnline)
    return () => { cancelado = true; window.removeEventListener('online', onOnline) }
  }, [nome, userLoading, tentativa])

  // Filtrar por busca (OS ou cliente)
  const termo = busca.trim().toLowerCase()
  const resultados = termo
    ? todos.filter(r =>
        r.ordemServico.toLowerCase().includes(termo) ||
        r.cliente.toLowerCase().includes(termo)
      )
    : todos

  const baixarFoto = async (foto: FotoItem, osId: string) => {
    if (baixando) return
    setBaixando(foto.campo + osId)
    try {
      const resp = await fetch(foto.url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const blob = await resp.blob()
      const extUrl = foto.url.split('?')[0].split('.').pop() || ''
      const ext = /^[a-z0-9]{2,5}$/i.test(extUrl) ? extUrl : 'jpg'
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `${osId}_${foto.campo}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revogar na hora cancela o download em alguns navegadores (Safari/Firefox)
      setTimeout(() => URL.revokeObjectURL(href), 10000)
    } catch {
      alert('Não foi possível baixar a foto. Verifique a conexão e tente novamente.')
    } finally {
      setBaixando(null)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#C41E2A', margin: '0 0 4px' }}>
          Fotos
        </h1>
        <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
          Todas as fotos das suas OS enviadas
        </p>
      </div>

      {/* Barra de busca / filtro */}
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <Search size={18} color="#9CA3AF" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          value={busca}
          onChange={e => { setBusca(e.target.value); setOsAberta(null) }}
          placeholder="Filtrar por OS ou cliente..."
          style={{
            width: '100%', padding: '12px 12px 12px 40px', borderRadius: 12,
            border: '2px solid #E5E7EB', fontSize: 16, outline: 'none',
            boxSizing: 'border-box', background: '#FAFAFA',
          }}
        />
      </div>

      {/* Loading */}
      {carregando && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Loader2 size={28} color="#C41E2A" className="spinner" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: 14, color: '#6B7280' }}>Carregando fotos...</div>
        </div>
      )}

      {/* Erro de rede */}
      {!carregando && erroCarga && todos.length === 0 && (
        <div style={{
          background: '#fff', borderRadius: 16, padding: 32,
          textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <WifiOff size={36} color="#9CA3AF" style={{ margin: '0 auto 12px', display: 'block' }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>Não consegui carregar as fotos</div>
          <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4, marginBottom: 16 }}>
            Verifique a conexão e tente de novo.
          </div>
          <button onClick={() => setTentativa(t => t + 1)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px',
            borderRadius: 12, border: 'none', background: '#C41E2A', color: '#fff',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>
            <RefreshCw size={16} /> Tentar de novo
          </button>
        </div>
      )}

      {/* Sem fotos */}
      {!carregando && !(erroCarga && todos.length === 0) && resultados.length === 0 && (
        <div style={{
          background: '#fff', borderRadius: 16, padding: 40,
          textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <Camera size={40} color="#D1D5DB" style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: '#6B7280' }}>
            {termo ? 'Nenhuma foto encontrada' : 'Nenhuma OS enviada com fotos'}
          </div>
          {termo && (
            <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 4 }}>
              Verifique o numero da OS ou nome do cliente
            </div>
          )}
        </div>
      )}

      {/* Lista de resultados agrupados por OS */}
      {!carregando && resultados.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {resultados.map(res => {
            const aberta = osAberta === res.ordemServico
            return (
              <div key={res.ordemServico} style={{
                background: '#fff', borderRadius: 16, overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                border: aberta ? '2px solid #C41E2A' : '1px solid #E5E7EB',
              }}>
                {/* Header clicavel */}
                <div
                  onClick={() => setOsAberta(aberta ? null : res.ordemServico)}
                  style={{
                    padding: '14px 16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: 12,
                    background: '#FEE2E2',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Camera size={20} color="#C41E2A" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#C41E2A' }}>{res.ordemServico}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: '#DBEAFE', color: '#2563EB',
                      }}>
                        {res.fotos.length} foto{res.fotos.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {res.cliente}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>
                      {formatarData(res.data)}
                    </div>
                  </div>
                  {aberta
                    ? <ChevronLeft size={18} color="#9CA3AF" style={{ transform: 'rotate(-90deg)' }} />
                    : <ChevronRight size={18} color="#9CA3AF" style={{ transform: 'rotate(90deg)' }} />
                  }
                </div>

                {/* Grid de fotos */}
                {aberta && (
                  <div style={{ padding: '0 14px 14px' }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                      gap: 8,
                    }}>
                      {res.fotos.map(foto => (
                        <div key={foto.campo} style={{
                          borderRadius: 10, overflow: 'hidden',
                          border: '1px solid #E5E7EB', background: '#F9FAFB',
                        }}>
                          <div
                            onClick={() => setFotoAberta(foto)}
                            style={{ cursor: 'pointer', position: 'relative', paddingTop: '75%' }}
                          >
                            <img
                              src={foto.url}
                              alt={foto.label}
                              style={{
                                position: 'absolute', inset: 0, width: '100%', height: '100%',
                                objectFit: 'cover',
                              }}
                            />
                          </div>
                          <div style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#374151', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{foto.label}</span>
                            <button
                              onClick={() => baixarFoto(foto, res.ordemServico)}
                              disabled={baixando === foto.campo + res.ordemServico}
                              aria-label={`Baixar foto ${foto.label}`}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                width: 36, height: 36, margin: -8, flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                opacity: baixando === foto.campo + res.ordemServico ? 0.4 : 1,
                              }}
                            >
                              {baixando === foto.campo + res.ordemServico
                                ? <Loader2 size={15} color="#6B7280" className="spinner" />
                                : <Download size={15} color="#6B7280" />
                              }
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal foto ampliada */}
      {fotoAberta && (
        <div
          onClick={() => setFotoAberta(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: 'calc(16px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', maxWidth: 600, marginBottom: 12,
          }}>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{fotoAberta.label}</span>
            <button
              onClick={() => setFotoAberta(null)}
              aria-label="Fechar"
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10,
                width: 44, height: 44, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X size={18} color="#fff" />
            </button>
          </div>
          <img
            src={fotoAberta.url}
            alt={fotoAberta.label}
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '100%', maxHeight: '80vh',
              borderRadius: 8, objectFit: 'contain',
            }}
          />
        </div>
      )}

      <div style={{ height: 80 }} />
    </div>
  )
}
