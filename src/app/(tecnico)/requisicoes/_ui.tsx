'use client'
// Peças visuais das telas de Requisições e Garantias no "Estilo POS NewPortal" (22/10/2026).
// Só aparência — nada de lógica aqui. Usado por requisicoes/*, requisicoes-enviadas e garantias.
import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, type LucideIcon } from 'lucide-react'

/** Cores com significado fixo (sempre a mesma coisa em todo o app). */
export const COR = {
  fazer: '#7C3AED',     // aguardando / para fazer
  andamento: '#2563EB', // em andamento
  pendente: '#D97706',  // pendente / esperando
  feita: '#16A34A',     // feita / aprovada / enviada
  erro: '#DC2626',      // atrasada / recusada / erro
  neutro: '#64748B',
  principal: '#0369A1', // azul do portal: botões e links
} as const

export const T = {
  texto: '#0F172A',
  textoMedio: '#475569',
  textoFraco: '#64748B',
  fantasma: '#CBD5E1',
  borda: '#E2E8F0',
  cartao: '#FEFEFE',
  fundo: '#EEF2F6',
} as const

/** fundo clarinho / borda clarinha a partir de uma cor cheia (hex de 6 dígitos) */
export const claro = (cor: string) => `color-mix(in srgb, ${cor} 8%, #FEFEFE)`
export const bordaDe = (cor: string) => `color-mix(in srgb, ${cor} 26%, #E2E8F0)`

export const cartao: CSSProperties = {
  background: T.cartao, border: `1px solid ${T.borda}`, borderRadius: 16, padding: 14,
  boxSizing: 'border-box', minWidth: 0,
}

export const campo: CSSProperties = {
  width: '100%', minHeight: 46, padding: '11px 14px', borderRadius: 12,
  border: `1px solid ${T.borda}`, background: T.cartao, color: T.texto,
  fontSize: 15, fontWeight: 400, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit', transition: 'border-color .15s',
}

export const rotulo: CSSProperties = {
  fontSize: 13, fontWeight: 400, color: T.textoMedio, display: 'block', marginBottom: 6,
}

export function botaoPrincipal(desligado = false): CSSProperties {
  return {
    width: '100%', minHeight: 46, padding: '0 18px', borderRadius: 12, border: 'none',
    background: desligado ? T.fantasma : COR.principal, color: '#fff',
    fontSize: 15, fontWeight: 500, cursor: desligado ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    textDecoration: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  }
}

export const botaoSecundario: CSSProperties = {
  width: '100%', minHeight: 46, padding: '0 16px', borderRadius: 12,
  border: `1px solid ${T.borda}`, background: T.cartao, color: T.texto,
  fontSize: 15, fontWeight: 400, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  textDecoration: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}

/** botão branco com texto vermelho (ações de cancelar) */
export const botaoPerigo: CSSProperties = {
  ...botaoSecundario, color: COR.erro, border: `1px solid ${bordaDe(COR.erro)}`,
}

/** Foco azul-claro nos campos (inline não tem :focus). Coloque <EstiloCampos /> uma vez na tela. */
export function EstiloCampos() {
  return (
    <style>{`
      .rq-campo:focus { border-color: #38BDF8 !important; }
      .rq-campo::placeholder { color: #94A3B8; }
      .rq-toque { transition: transform .12s ease; -webkit-tap-highlight-color: transparent; }
      .rq-toque:active { transform: scale(.985); }
    `}</style>
  )
}

/** Quadradinho com ícone: cheio (cor + ícone branco) ou clarinho (fundo claro + ícone na cor). */
export function Icone({ icon: Ic, cor, cheio = false, tam = 40 }: { icon: LucideIcon; cor: string; cheio?: boolean; tam?: number }) {
  return (
    <span style={{
      width: tam, height: tam, borderRadius: 11, flex: 'none',
      display: 'grid', placeItems: 'center',
      background: cheio ? cor : claro(cor),
      border: cheio ? 'none' : `1px solid ${bordaDe(cor)}`,
      color: cheio ? '#fff' : cor,
    }}>
      <Ic size={Math.round(tam * 0.47)} />
    </span>
  )
}

/** Etiqueta (pílula) com a cor da situação. */
export function Pilula({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%',
      fontSize: 12, fontWeight: 400, lineHeight: 1.3, padding: '3px 10px', borderRadius: 999,
      color: cor, background: claro(cor), border: `1px solid ${bordaDe(cor)}`,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      {children}
    </span>
  )
}

/** Link "Voltar" discreto. */
export function Voltar({ href }: { href: string }) {
  return (
    <Link href={href} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
      color: COR.principal, fontSize: 14, fontWeight: 400, textDecoration: 'none',
      padding: '6px 12px 6px 8px', borderRadius: 999,
      background: T.cartao, border: `1px solid ${T.borda}`,
    }}>
      <ArrowLeft size={17} /> Voltar
    </Link>
  )
}

/** Cabeçalho da tela: ícone + título + subtítulo (+ ação à direita). */
export function Cabecalho({ icon, cor = COR.principal, titulo, subtitulo, acao }: {
  icon: LucideIcon; cor?: string; titulo: ReactNode; subtitulo?: ReactNode; acao?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <Icone icon={icon} cor={cor} tam={44} />
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: T.texto }}>{titulo}</h1>
        {subtitulo && <div style={{ fontSize: 13, color: T.textoMedio, marginTop: 2 }}>{subtitulo}</div>}
      </div>
      {acao}
    </div>
  )
}

/** Tela de "deu certo" depois de enviar. */
export function TelaSucesso({ icon, titulo, texto, href, botao }: {
  icon: LucideIcon; titulo: string; texto: ReactNode; href: string; botao: string
}) {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0',
    }}>
      <div style={{ ...cartao, width: '100%', maxWidth: 420, padding: '28px 20px', textAlign: 'center', display: 'grid', gap: 10, justifyItems: 'center' }}>
        <Icone icon={icon} cor={COR.feita} cheio tam={56} />
        <h2 style={{ margin: '6px 0 0', fontSize: 20, fontWeight: 500, color: T.texto }}>{titulo}</h2>
        <p style={{ margin: 0, fontSize: 14, color: T.textoMedio, lineHeight: 1.5 }}>{texto}</p>
        <Link href={href} style={{ ...botaoPrincipal(), marginTop: 10 }}>{botao}</Link>
      </div>
    </div>
  )
}
