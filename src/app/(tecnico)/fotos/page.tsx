'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { supabase } from '@/lib/supabase'
import { offlineGet, offlineSet } from '@/lib/offlineCache'
import { Search, Download, Camera, X, Loader2, ChevronLeft, ChevronRight, CloudOff } from 'lucide-react'

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
  FotoHorimetro: 'Horímetro',
  FotoChassis: 'Chassi',
  FotoFrente: 'Frente',
  FotoDireita: 'Direita',
  FotoEsquerda: 'Esquerda',
  FotoTraseira: 'Traseira',
  FotoVolante: 'Volante',
  FotoFalha1: 'Falha 1',
  FotoFalha2: 'Falha 2',
  FotoFalha3: 'Falha 3',
  FotoFalha4: 'Falha 4',
  FotoPecaNova1: 'Peça nova 1',
  FotoPecaNova2: 'Peça nova 2',
  FotoPecaInstalada1: 'Peça instalada 1',
  FotoPecaInstalada2: 'Peça instalada 2',
  FotoAlmoco: 'Almoço',
  FotoExtra1: 'Extra 1',
  FotoExtra2: 'Extra 2',
  FotoExtra3: 'Extra 3',
  FotoExtra4: 'Extra 4',
  FotoExtra5: 'Extra 5',
}

// Também as fotos extras (lista) e as de almoço por dia (José, 23/10/2026) — mesmo formato que o syncManager grava.
const FOTO_CAMPOS = Object.keys(FOTO_LABELS)
const CAMPOS_SELECT = FOTO_CAMPOS.join(', ') + ', FotosExtras, AlmocosFotos, TecResp1, Data, Ordem_Servico'

function formatarData(d: string) {
  if (!d || d === '-') return '-'
  const [y, m, day] = d.slice(0, 10).split('-')
  return day ? `${day}/${m}/${y}` : d
}

const urlValida = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function montarResultados(registros: any[], clienteMap: Record<string, string>): ResultadoOS[] {
  // uma OS pode ter mais de um registro: junta tudo num cartão só (antes repetia a chave)
  const porOS = new Map<string, ResultadoOS & { vistas: Set<string> }>()
  for (const rec of registros) {
    const os = String(rec.Ordem_Servico)
    let r = porOS.get(os)
    if (!r) {
      r = {
        ordemServico: os, tecnico: (rec.TecResp1 as string) || '-', cliente: clienteMap[os] || '-',
        data: (rec.Data as string) || '-', fotos: [], vistas: new Set(),
      }
      porOS.set(os, r)
    }
    const add = (url: unknown, label: string, campo: string) => {
      if (!urlValida(url) || r!.vistas.has(url)) return
      r!.vistas.add(url)
      r!.fotos.push({ label, url, campo })
    }
    for (const campo of FOTO_CAMPOS) {
      if (/^FotoExtra\d$|^FotoAlmoco$/.test(campo)) continue // vêm das listas abaixo (e de novo no fim, se só existirem soltas)
      add(rec[campo], FOTO_LABELS[campo], campo)
    }
    const extras = Array.isArray(rec.FotosExtras) ? rec.FotosExtras : []
    // item pode ser URL ou objeto ({ v } / { url } / { foto })
    const urlDe = (x: unknown) => (x && typeof x === 'object' ? (x as Record<string, unknown>).v ?? (x as Record<string, unknown>).url ?? (x as Record<string, unknown>).foto : x)
    extras.forEach((u: unknown, i: number) => add(urlDe(u), `Extra ${i + 1}`, `FotoExtra${i + 1}`))
    for (let i = 1; i <= 5; i++) add(rec[`FotoExtra${i}`], `Extra ${i}`, `FotoExtra${i}`)
    const almocos = Array.isArray(rec.AlmocosFotos) ? rec.AlmocosFotos : []
    almocos.forEach((a: { data?: string; foto?: unknown }, i: number) =>
      add(a?.foto, a?.data ? `Almoço ${formatarData(a.data)}` : 'Almoço', `FotoAlmoco_${a?.data || i}`))
    add(rec.FotoAlmoco, 'Almoço', 'FotoAlmoco')
  }
  return [...porOS.values()]
    .map(({ vistas: _v, ...r }) => r) // eslint-disable-line @typescript-eslint/no-unused-vars
    .filter((r) => r.fotos.length > 0)
}

async function buscarFotos(nome: string): Promise<ResultadoOS[]> {
  const { data: regs, error } = await supabase
    .from('Ordem_Servico_Tecnicos')
    .select(CAMPOS_SELECT)
    .or(`TecResp1.ilike.%${nome}%,TecResp2.ilike.%${nome}%`)
    .eq('Status', 'enviado')
    .order('Data', { ascending: false })
    .limit(200)
  if (error) throw error
  const registros = (regs || []) as unknown as Record<string, unknown>[]
  if (registros.length === 0) return []
  const uniqueIds = [...new Set(registros.map((r) => String(r.Ordem_Servico)))]
  const { data: osData } = await supabase
    .from('Ordem_Servico')
    .select('Id_Ordem, Os_Cliente')
    .in('Id_Ordem', uniqueIds)
  const clienteMap: Record<string, string> = {}
  osData?.forEach((o: { Id_Ordem: string; Os_Cliente: string }) => {
    clienteMap[String(o.Id_Ordem)] = o.Os_Cliente || '-'
  })
  return montarResultados(registros, clienteMap)
}

export default function FotosTecnicoPage() {
  const { user } = useCurrentUser()
  const nome = user?.nome_pos || user?.tecnico_nome || ''

  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [todos, setTodos] = useState<ResultadoOS[]>([])
  // erro de rede não vira "sem fotos": avisa e mostra o que está guardado
  const [aviso, setAviso] = useState('')
  const [visor, setVisor] = useState<{ os: string; fotos: FotoItem[]; idx: number } | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)
  const [osAberta, setOsAberta] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!nome) return
    const chave = `fotos-tecnico:${nome.toUpperCase()}`
    setCarregando(true)
    setAviso('')
    try {
      if (!navigator.onLine) throw new Error('offline')
      const r = await buscarFotos(nome)
      setTodos(r)
      offlineSet(chave, r).catch(() => {})
    } catch (e) {
      const salvo = await offlineGet<ResultadoOS[]>(chave)
      const m = String((e as Error)?.message || e).toLowerCase()
      const semRede = !navigator.onLine || /offline|fetch|network|load failed|timeout|aborted/.test(m)
      setTodos(salvo || [])
      setAviso(`${semRede ? 'Sem internet' : 'Não deu para carregar as fotos'}${salvo ? ' — mostrando o que está guardado no celular.' : '.'}`)
    }
    setCarregando(false)
  }, [nome])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => {
    const on = () => carregar()
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [carregar])

  // Filtrar por busca (OS ou cliente)
  const termo = busca.trim().toLowerCase()
  const resultados = termo
    ? todos.filter(r =>
        r.ordemServico.toLowerCase().includes(termo) ||
        r.cliente.toLowerCase().includes(termo)
      )
    : todos

  // Baixar: no iPhone/PWA o <a download> não funciona — usa o compartilhar do sistema (salvar imagem) quando existe.
  const baixarFoto = async (foto: FotoItem, osId: string) => {
    setBaixando(foto.campo + osId)
    try {
      const resp = await fetch(foto.url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const blob = await resp.blob()
      const ext = foto.url.split('.').pop()?.split('?')[0] || 'jpg'
      const nomeArq = `${osId}_${foto.campo}.${ext}`
      const arquivo = new File([blob], nomeArq, { type: blob.type || 'image/jpeg' })
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
      let feito = false
      if (nav.share && nav.canShare?.({ files: [arquivo] })) {
        try {
          await nav.share({ files: [arquivo], title: nomeArq })
          feito = true
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') feito = true // a pessoa cancelou
        }
      }
      if (!feito) {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = nomeArq
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60_000) // revogar na hora cancelava o download
      }
    } catch {
      alert(navigator.onLine ? 'Erro ao baixar a foto.' : 'Sem internet — não deu para baixar a foto.')
    }
    setBaixando(null)
  }

  // visor: deslizar o dedo para o lado troca de foto
  const toqueX = useRef<number | null>(null)
  const passar = (d: number) => setVisor((v) => {
    if (!v) return v
    const idx = (v.idx + d + v.fotos.length) % v.fotos.length
    return { ...v, idx }
  })
  useEffect(() => {
    if (!visor) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') passar(-1)
      else if (e.key === 'ArrowRight') passar(1)
      else if (e.key === 'Escape') setVisor(null)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [visor])
  const fotoAberta = visor ? visor.fotos[visor.idx] : null

  // Estilo POS NewPortal (22/10/2026): azul do portal no lugar do vermelho antigo, cartões brancos
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: '#DB2777', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Camera size={21} color="#fff" />
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: '#0F172A', margin: 0 }}>
            Fotos
          </h1>
          <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>
            Todas as fotos das suas OS enviadas
          </p>
        </div>
      </div>

      {/* Barra de busca / filtro */}
      <div style={{ position: 'relative' }}>
        <Search size={18} color="#64748B" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          value={busca}
          onChange={e => { setBusca(e.target.value); setOsAberta(null) }}
          placeholder="Filtrar por OS ou cliente..."
          onFocus={e => { e.currentTarget.style.borderColor = '#38BDF8' }}
          onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0' }}
          style={{
            width: '100%', height: 46, padding: '0 14px 0 42px', borderRadius: 12,
            border: '1px solid #E2E8F0', fontSize: 15, outline: 'none', color: '#0F172A',
            boxSizing: 'border-box', background: '#FEFEFE',
          }}
        />
      </div>

      {/* Aviso de sem internet / erro */}
      {!carregando && aviso && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14,
          background: '#FFFBEB', border: '1px solid #FDE68A',
        }}>
          <CloudOff size={18} color="#D97706" style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: '#0F172A', lineHeight: 1.4 }}>{aviso}</span>
          <button onClick={carregar} style={{
            flexShrink: 0, minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid #E2E8F0',
            background: '#FEFEFE', color: '#0369A1', fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Tentar de novo
          </button>
        </div>
      )}

      {/* Loading */}
      {carregando && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Loader2 size={28} color="#0369A1" className="spinner" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: 14, color: '#475569' }}>Carregando fotos...</div>
        </div>
      )}

      {/* Sem fotos */}
      {!carregando && resultados.length === 0 && !(aviso && todos.length === 0) && (
        <div style={{
          background: '#FEFEFE', borderRadius: 16, padding: '30px 20px',
          textAlign: 'center', border: '1px dashed #CBD5E1',
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <Camera size={21} color="#64748B" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, color: '#475569' }}>
            {termo ? 'Nenhuma foto encontrada' : 'Nenhuma OS enviada com fotos'}
          </div>
          {termo && (
            <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
              Verifique o número da OS ou nome do cliente
            </div>
          )}
        </div>
      )}

      {/* Lista de resultados agrupados por OS */}
      {!carregando && resultados.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {resultados.map(res => {
            const aberta = osAberta === res.ordemServico
            return (
              <div key={res.ordemServico} style={{
                background: '#FEFEFE', borderRadius: 16, overflow: 'hidden',
                border: `1px solid ${aberta ? '#BAE6FD' : '#E2E8F0'}`, minWidth: 0,
              }}>
                {/* Header clicavel */}
                <div
                  onClick={() => setOsAberta(aberta ? null : res.ordemServico)}
                  style={{
                    padding: 14, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 11,
                    background: aberta ? '#0369A1' : '#E0F2FE',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Camera size={19} color={aberta ? '#fff' : '#0369A1'} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, padding: '0 8px', borderRadius: 7, background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>{res.ordemServico}</span>
                      <span style={{
                        fontSize: 12, fontWeight: 500, padding: '1px 9px', borderRadius: 999,
                        background: '#EFF6FF', color: '#2563EB',
                      }}>
                        {res.fotos.length} foto{res.fotos.length > 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {res.cliente}
                    </div>
                    <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 1 }}>
                      {formatarData(res.data)}
                    </div>
                  </div>
                  {aberta
                    ? <ChevronLeft size={18} color="#94A3B8" style={{ transform: 'rotate(90deg)', flexShrink: 0 }} />
                    : <ChevronRight size={18} color="#94A3B8" style={{ transform: 'rotate(90deg)', flexShrink: 0 }} />
                  }
                </div>

                {/* Grid de fotos */}
                {aberta && (
                  <div style={{ padding: '0 12px 12px' }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(130px, 100%), 1fr))',
                      gap: 8,
                    }}>
                      {res.fotos.map((foto, i) => (
                        <div key={foto.url} style={{
                          borderRadius: 12, overflow: 'hidden', minWidth: 0,
                          border: '1px solid #E2E8F0', background: '#FEFEFE',
                        }}>
                          <div
                            onClick={() => setVisor({ os: res.ordemServico, fotos: res.fotos, idx: i })}
                            style={{ cursor: 'pointer', position: 'relative', paddingTop: '75%', background: '#EEF2F6' }}
                          >
                            <img
                              src={foto.url}
                              alt={foto.label}
                              loading="lazy"
                              style={{
                                position: 'absolute', inset: 0, width: '100%', height: '100%',
                                objectFit: 'cover',
                              }}
                            />
                          </div>
                          <div style={{ padding: '4px 4px 4px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 12.5, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{foto.label}</span>
                            <button
                              onClick={() => baixarFoto(foto, res.ordemServico)}
                              disabled={baixando === foto.campo + res.ordemServico}
                              aria-label="baixar"
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', flexShrink: 0,
                                opacity: baixando === foto.campo + res.ordemServico ? 0.4 : 1,
                              }}
                            >
                              {baixando === foto.campo + res.ordemServico
                                ? <Loader2 size={15} color="#0369A1" className="spinner" />
                                : <Download size={15} color="#0369A1" />
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

      {/* Visor da foto ampliada — deslizar para o lado troca de foto */}
      {visor && fotoAberta && (
        <div
          onClick={() => setVisor(null)}
          onTouchStart={(e) => { toqueX.current = e.touches[0]?.clientX ?? null }}
          onTouchEnd={(e) => {
            const x0 = toqueX.current
            toqueX.current = null
            const x1 = e.changedTouches[0]?.clientX
            if (x0 == null || x1 == null) return
            const dx = x1 - x0
            if (Math.abs(dx) > 50) { e.preventDefault(); passar(dx < 0 ? 1 : -1) }
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(15,23,42,0.92)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: 16, touchAction: 'pan-y',
          }}
        >
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
            width: '100%', maxWidth: 600, marginBottom: 12,
          }}>
            <span style={{ color: '#fff', fontSize: 15, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {fotoAberta.label}
              <span style={{ color: '#CBD5E1', fontWeight: 400 }}> · {visor.idx + 1} de {visor.fotos.length}</span>
            </span>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button
                onClick={(e) => { e.stopPropagation(); baixarFoto(fotoAberta, visor.os) }}
                aria-label="baixar"
                style={{
                  background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 11,
                  width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
              >
                {baixando === fotoAberta.campo + visor.os ? <Loader2 size={17} color="#fff" className="spinner" /> : <Download size={17} color="#fff" />}
              </button>
              <button
                onClick={() => setVisor(null)}
                aria-label="fechar"
                style={{
                  background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 11,
                  width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
              >
                <X size={18} color="#fff" />
              </button>
            </div>
          </div>
          <div style={{ position: 'relative', width: '100%', maxWidth: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img
              key={fotoAberta.url}
              src={fotoAberta.url}
              alt={fotoAberta.label}
              onClick={e => e.stopPropagation()}
              draggable={false}
              style={{
                maxWidth: '100%', maxHeight: '78vh',
                borderRadius: 12, objectFit: 'contain', userSelect: 'none',
              }}
            />
            {visor.fotos.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); passar(-1) }}
                  aria-label="foto anterior"
                  style={setaVisor('left')}
                >
                  <ChevronLeft size={22} color="#fff" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); passar(1) }}
                  aria-label="próxima foto"
                  style={setaVisor('right')}
                >
                  <ChevronRight size={22} color="#fff" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ height: 66 }} />
    </div>
  )
}

function setaVisor(lado: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute', top: '50%', [lado]: 4, transform: 'translateY(-50%)',
    width: 40, height: 40, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
}
