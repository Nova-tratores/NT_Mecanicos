'use client'
// "Veículo utilizado" do relatório (José, 22/10/2026): já vem o carro vinculado ao técnico (Frota), com foto.
// Trocar abre a lista da frota com fotos e busca por marca, modelo e placa; o "i" mostra a foto grande e a ficha.
// Grava o mesmo NumPlaca de antes (cadastro SupaPlacas) — o portal lê assim. Funciona offline com a última lista.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Truck, Search, Info, X, Check, Wrench, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { offlineGet, offlineSet } from '@/lib/offlineCache'
import { colors } from '@/lib/ui'

export interface CarroFrota {
  placa: string; numPlaca: string; marca: string | null; modelo: string | null; descricao: string | null
  ano: number | null; anoModelo: number | null; cor: string | null; combustivel: string | null; tanque: number | null
  tipo: string | null; setor: string | null; foto: string | null; tecnico: string | null
}
interface Lista { tecnico: string; meu: string | null; carros: CarroFrota[] }

const CHAVE = 'prefetch:frota-carros'
const sem = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
const titulo = (c: CarroFrota) => {
  const m = [c.marca, c.modelo].filter(Boolean).join(' ')
  return (m || c.descricao || c.numPlaca).replace(/^I\//, '')
}
const placaBonita = (p: string) => (p.length === 7 ? `${p.slice(0, 3)}-${p.slice(3)}` : p)
const bonito = (s: string | null) => (s ? s.toLowerCase().replace(/(^|\s|\/)(\S)/g, (_m, a: string, b: string) => a + b.toUpperCase()) : '')

/** lista da frota (rede → cache) e o carro do técnico */
export function useCarrosFrota() {
  const [lista, setLista] = useState<Lista | null>(null)
  useEffect(() => {
    let vivo = true
    ;(async () => {
      const cache = await offlineGet<Lista>(CHAVE).catch(() => null)
      if (vivo && cache) setLista(cache)
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) throw new Error('sem login')
        const r = await fetch('/api/frota-carros', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
        if (!r.ok) throw new Error(String(r.status))
        const j = (await r.json()) as Lista
        if (!vivo) return
        setLista(j)
        void offlineSet(CHAVE, j)
      } catch {
        // sem rede e sem cache: lista vazia = a tela usa as placas antigas
        if (vivo && !cache) setLista({ tecnico: '', meu: null, carros: [] })
      }
    })()
    return () => { vivo = false }
  }, [])
  return lista
}

export default function EscolherVeiculo({ valor, onChange, lista, legados }: {
  valor: string
  onChange: (numPlaca: string) => void
  lista: Lista | null
  /** placas do cadastro antigo (se a lista da frota não carregar) */
  legados: { IdPlaca: number; NumPlaca: string }[]
}) {
  const [aberto, setAberto] = useState(false)
  const [ficha, setFicha] = useState<CarroFrota | null>(null)
  const carros = lista?.carros || []
  const escolhido = carros.find((c) => c.numPlaca === valor) || null
  const meu = lista?.meu || null

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} style={cartao(!!valor)}>
        {valor === 'OFICINA' ? (
          <span style={fotoBox}><Wrench size={22} color={colors.textMuted} /></span>
        ) : escolhido?.foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={escolhido.foto} alt="" style={{ ...fotoBox, objectFit: 'contain', background: '#F1F5F9' }} />
        ) : (
          <span style={fotoBox}><Truck size={22} color={colors.textMuted} /></span>
        )}
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          {!valor ? (
            <>
              <span style={{ display: 'block', fontSize: 15.5, color: colors.text }}>Escolher o carro</span>
              <span style={{ display: 'block', fontSize: 13, color: colors.textSubtle }}>Toque para ver a frota</span>
            </>
          ) : valor === 'OFICINA' ? (
            <>
              <span style={{ display: 'block', fontSize: 15.5, color: colors.text }}>Oficina</span>
              <span style={{ display: 'block', fontSize: 13, color: colors.textSubtle }}>Sem carro — serviço na loja</span>
            </>
          ) : (
            <>
              <span style={{ display: 'block', fontSize: 15.5, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{escolhido ? bonito(titulo(escolhido)) : valor}</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: colors.textSubtle, flexWrap: 'wrap' }}>
                {escolhido && <span style={placaTag}>{placaBonita(escolhido.placa)}</span>}
                {valor === meu && <span style={{ color: colors.success }}>seu carro</span>}
              </span>
            </>
          )}
        </span>
        <span style={{ color: colors.primary, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>Trocar <ChevronRight size={16} /></span>
      </button>
      {escolhido && (
        <button type="button" onClick={() => setFicha(escolhido)} style={linkFicha}><Info size={14} /> Ver foto e ficha do carro</button>
      )}

      {aberto && createPortal(
        <Folha titulo="Qual carro você usou?" onFechar={() => setAberto(false)}>
          <ListaCarros
            carros={carros} carregando={!lista} legados={legados} valor={valor} meu={meu}
            onEscolher={(v) => { onChange(v); setAberto(false) }}
            onFicha={setFicha}
          />
        </Folha>, document.body,
      )}
      {ficha && createPortal(<Ficha carro={ficha} meu={ficha.numPlaca === meu} onFechar={() => setFicha(null)} />, document.body)}
    </>
  )
}

function ListaCarros({ carros, carregando, legados, valor, meu, onEscolher, onFicha }: {
  carros: CarroFrota[]; carregando: boolean; legados: { IdPlaca: number; NumPlaca: string }[]; valor: string; meu: string | null
  onEscolher: (numPlaca: string) => void; onFicha: (c: CarroFrota) => void
}) {
  const [busca, setBusca] = useState('')
  const filtrados = useMemo(() => {
    const termos = sem(busca).split(/\s+/).filter(Boolean)
    const ok = (c: CarroFrota) => {
      const alvo = sem([c.marca, c.modelo, c.descricao, c.placa, placaBonita(c.placa), c.numPlaca, c.tecnico].join(' '))
      return termos.every((t) => alvo.includes(t))
    }
    // o carro do técnico primeiro, depois por nome
    return carros.filter(ok).sort((a, b) => Number(b.numPlaca === meu) - Number(a.numPlaca === meu) || titulo(a).localeCompare(titulo(b), 'pt-BR'))
  }, [carros, busca, meu])
  // sem a lista nova (offline na 1ª vez): as placas antigas
  const soLegado = carregando ? false : carros.length === 0

  return (
    <>
      <div style={{ position: 'relative', margin: '0 16px 10px' }}>
        <Search size={17} color={colors.textSubtle} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por marca, modelo ou placa"
          style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${colors.borderStrong}`, borderRadius: 12, padding: '12px 12px 12px 38px', fontSize: 16, color: colors.text, background: colors.surface }} />
      </div>
      <div style={{ overflowY: 'auto', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!busca && (
          <button type="button" onClick={() => onEscolher('OFICINA')} style={linha(valor === 'OFICINA')}>
            <span style={fotoLista}><Wrench size={20} color={colors.textMuted} /></span>
            <span style={{ flex: 1, textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: 15, color: colors.text }}>Oficina</span>
              <span style={{ display: 'block', fontSize: 12.5, color: colors.textSubtle }}>Sem carro — serviço na loja</span>
            </span>
            {valor === 'OFICINA' && <Check size={20} color={colors.primary} />}
          </button>
        )}
        {soLegado ? legados.filter((l) => sem(l.NumPlaca).includes(sem(busca))).map((l) => (
          <button key={l.IdPlaca} type="button" onClick={() => onEscolher(l.NumPlaca)} style={linha(valor === l.NumPlaca)}>
            <span style={fotoLista}><Truck size={20} color={colors.textMuted} /></span>
            <span style={{ flex: 1, textAlign: 'left', fontSize: 15, color: colors.text }}>{l.NumPlaca}</span>
            {valor === l.NumPlaca && <Check size={20} color={colors.primary} />}
          </button>
        )) : filtrados.map((c) => (
          <div key={c.placa} style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
            <button type="button" onClick={() => onEscolher(c.numPlaca)} style={{ ...linha(valor === c.numPlaca), flex: 1, minWidth: 0 }}>
              {c.foto
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={c.foto} alt="" loading="lazy" style={{ ...fotoLista, objectFit: 'contain', background: '#F1F5F9' }} />
                : <span style={fotoLista}><Truck size={20} color={colors.textMuted} /></span>}
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 15, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bonito(titulo(c))}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: colors.textSubtle, marginTop: 2, flexWrap: 'wrap' }}>
                  <span style={placaTag}>{placaBonita(c.placa)}</span>
                  {c.numPlaca === meu ? <span style={{ color: colors.success }}>seu carro</span> : c.tecnico ? <span>{bonito(c.tecnico)}</span> : null}
                </span>
              </span>
              {valor === c.numPlaca && <Check size={20} color={colors.primary} />}
            </button>
            <button type="button" onClick={() => onFicha(c)} aria-label="Ver foto e ficha"
              style={{ width: 46, borderRadius: 14, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.primary, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Info size={19} />
            </button>
          </div>
        ))}
        {carregando && <div style={{ textAlign: 'center', color: colors.textSubtle, fontSize: 14, padding: 20 }}>Carregando a frota…</div>}
        {!carregando && !soLegado && filtrados.length === 0 && <div style={{ textAlign: 'center', color: colors.textSubtle, fontSize: 14, padding: 20 }}>Nenhum carro com “{busca}”.</div>}
      </div>
    </>
  )
}

function Ficha({ carro, meu, onFechar }: { carro: CarroFrota; meu: boolean; onFechar: () => void }) {
  const linhas: [string, string | number | null][] = [
    ['Placa', placaBonita(carro.placa)],
    ['Marca', bonito(carro.marca)],
    ['Modelo', bonito(carro.modelo)],
    ['Ano', carro.ano ? `${carro.ano}${carro.anoModelo && carro.anoModelo !== carro.ano ? `/${carro.anoModelo}` : ''}` : null],
    ['Cor', bonito(carro.cor)],
    ['Combustível', bonito(carro.combustivel)],
    ['Tanque', carro.tanque ? `${carro.tanque} L` : null],
    ['Tipo', bonito(carro.tipo)],
    ['Setor', bonito(carro.setor)],
    ['Técnico', carro.tecnico ? bonito(carro.tecnico) : null],
  ]
  return (
    <Folha titulo={bonito(titulo(carro))} onFechar={onFechar}>
      <div style={{ overflowY: 'auto', padding: '0 16px 20px' }}>
        <div style={{ borderRadius: 16, background: '#F1F5F9', height: 190, display: 'grid', placeItems: 'center', overflow: 'hidden', marginBottom: 12 }}>
          {carro.foto
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={carro.foto} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <Truck size={48} color={colors.textGhost} />}
        </div>
        {meu && <div style={{ fontSize: 13.5, color: colors.success, background: colors.successBg, border: `1px solid ${colors.successBorder}`, borderRadius: 10, padding: '8px 12px', marginBottom: 10 }}>Este é o carro vinculado a você na Frota.</div>}
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 16, background: colors.surface }}>
          {linhas.filter(([, v]) => v != null && v !== '').map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 14px', borderTop: i ? `1px solid ${colors.border}` : 'none', fontSize: 14.5 }}>
              <span style={{ color: colors.textSubtle }}>{k}</span>
              <span style={{ color: colors.text, textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </Folha>
  )
}

/** folha que sobe de baixo (tela cheia no celular) */
function Folha({ titulo: t, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onFechar() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', background: colors.surfaceAlt, borderRadius: '20px 20px 0 0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 12px' }}>
          <span style={{ flex: 1, fontSize: 17, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ width: 38, height: 38, borderRadius: 12, border: `1px solid ${colors.border}`, background: colors.surface, display: 'grid', placeItems: 'center', color: colors.textMuted }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

const cartao = (tem: boolean): React.CSSProperties => ({
  width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, cursor: 'pointer',
  border: `1px solid ${tem ? colors.primaryBorder : colors.borderStrong}`, background: tem ? '#F8FBFE' : colors.surface, font: 'inherit',
})
const fotoBox: React.CSSProperties = { width: 72, height: 52, borderRadius: 12, background: '#F1F5F9', display: 'grid', placeItems: 'center', flexShrink: 0 }
const fotoLista: React.CSSProperties = { width: 64, height: 46, borderRadius: 10, background: '#F1F5F9', display: 'grid', placeItems: 'center', flexShrink: 0 }
const placaTag: React.CSSProperties = { fontSize: 12, letterSpacing: '.04em', color: colors.text, background: colors.surface, border: `1px solid ${colors.borderStrong}`, borderRadius: 6, padding: '1px 7px', fontVariantNumeric: 'tabular-nums' }
const linkFicha: React.CSSProperties = { marginTop: 8, border: 'none', background: 'none', padding: 0, color: colors.primary, fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }
const linha = (sel: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 14, cursor: 'pointer', font: 'inherit',
  border: `1px solid ${sel ? colors.primary : colors.border}`, background: sel ? '#F0F8FD' : colors.surface,
})
