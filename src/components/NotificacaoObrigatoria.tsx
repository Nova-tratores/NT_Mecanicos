'use client'
// Notificação OBRIGATÓRIA para preencher OS (José, 22/10/2026: "força ele permitir a notificação no celular dele,
// se não ele não consegue preencher ordem"). É o push que faz o celular baixar as OS sozinho, mesmo com o app
// fechado — sem ele, o técnico que esquece de abrir o app na loja fica sem as OS no campo.
// Libera quando a permissão está concedida; a inscrição no servidor vai em segundo plano (José, 23/10/2026).
// Sem saída não pode (José, 23/10/2026): aparelho sem suporte (iPhone antigo, Safari sem instalar, navegador do
// WhatsApp) ou permissão negada ganham "Continuar sem notificação" depois da explicação — a escolha fica no aparelho.
import { useCallback, useEffect, useState } from 'react'
import { BellRing, Smartphone, Lock, Loader2 } from 'lucide-react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { colors } from '@/lib/ui'
import { pushSuportado, inscreverPush, pedirPermissaoEInscrever } from '@/lib/push-cliente'

type Estado = 'verificando' | 'ok' | 'pedir' | 'negado' | 'sem-suporte' | 'erro'
const SEM_NOTIF_LS = (uid: string) => `nt-sem-notificacao:${uid}`
function escolheuSemNotificacao(uid: string) {
  try { return !!uid && !!localStorage.getItem(SEM_NOTIF_LS(uid)) } catch { return false }
}

export default function NotificacaoObrigatoria({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCurrentUser()
  const [estado, setEstado] = useState<Estado>('verificando')
  const [msg, setMsg] = useState('')
  // "Continuar sem" no pedido só depois de uma tentativa que não funcionou (José, 23/10/2026)
  const [tentouSemSucesso, setTentouSemSucesso] = useState(false)
  const nome = user?.nome_pos || user?.tecnico_nome || ''
  const uid = user?.id || ''

  const conferir = useCallback(async () => {
    // no computador de desenvolvimento não há service worker: não trava
    if (process.env.NODE_ENV !== 'production') return 'ok' as Estado
    const semNotif = escolheuSemNotificacao(uid)
    if (!pushSuportado()) return (semNotif ? 'ok' : 'sem-suporte') as Estado
    if (Notification.permission === 'denied') return (semNotif ? 'ok' : 'negado') as Estado
    if (Notification.permission !== 'granted') return 'pedir' as Estado
    // permissão dada: libera já; a inscrição/gravação no servidor tenta em segundo plano (falha do
    // /api/push/subscribe não pode travar o preencher) (José, 23/10/2026)
    if (navigator.onLine) void inscreverEmSegundoPlano(nome)
    return 'ok' as Estado
  }, [nome, uid])

  const continuarSem = () => {
    try { if (uid) localStorage.setItem(SEM_NOTIF_LS(uid), new Date().toISOString()) } catch { /* sem espaço */ }
    setEstado('ok')
  }

  useEffect(() => {
    // usuário ainda carregando: fica em "verificando" (sem uid a escolha "continuar sem" não é lida)
    if (loading || !user) return
    let vivo = true
    conferir().then((e) => { if (vivo) setEstado(e) })
    return () => { vivo = false }
  }, [conferir, loading, user])

  const permitir = async () => {
    setMsg('')
    try {
      const p = await pedirPermissaoEInscrever(nome)
      if (p === 'sem-suporte') { setEstado('sem-suporte'); return }
      if (p === 'denied') { setEstado('negado'); return }
      if (p !== 'granted') {
        // o Chrome às vezes nem mostra a janela (pedido silencioso) e volta 'default'
        setTentouSemSucesso(true)
        setMsg('O celular não mostrou a janela de permissão. Toque de novo ou libere nas configurações do celular.')
        return
      }
      setEstado('ok')
    } catch { setTentouSemSucesso(true); setMsg('Não deu certo, tente de novo.'); setEstado('erro') }
  }

  if (estado === 'ok') return <>{children}</>
  if (estado === 'verificando') return <div style={{ padding: 40, textAlign: 'center', color: colors.textSubtle }}><Loader2 size={22} className="girar" /><style>{`.girar{animation:girar 1s linear infinite}@keyframes girar{to{transform:rotate(360deg)}}`}</style></div>

  const card: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 20, display: 'grid', gap: 12, margin: '16px 0' }
  const icone = (I: typeof BellRing, cor: string) => (
    <span style={{ width: 52, height: 52, borderRadius: 14, display: 'grid', placeItems: 'center', background: `color-mix(in srgb, ${cor} 10%, #fefefe)`, color: cor }}><I size={26} /></span>
  )
  return (
    <div style={{ padding: '8px 4px' }}>
      <div style={card}>
        {estado === 'sem-suporte' ? (
          <>
            {icone(Smartphone, colors.warning)}
            <div style={{ fontSize: 18, color: colors.text }}>Instale o app no celular</div>
            <div style={{ fontSize: 14.5, color: colors.textMuted, lineHeight: 1.5 }}>
              Para preencher OS o app precisa receber notificações — é assim que as suas ordens chegam no celular mesmo sem você abrir o app.
              Neste aparelho isso só funciona com o app instalado:
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14.5, color: colors.text, lineHeight: 1.6 }}>
              <li><b style={{ fontWeight: 500 }}>iPhone:</b> no Safari, toque em Compartilhar → “Adicionar à Tela de Início”, e abra o app pelo ícone.</li>
              <li><b style={{ fontWeight: 500 }}>Android:</b> use o Chrome e toque em “Instalar app” (menu ⋮).</li>
              <li>Se abriu pelo WhatsApp, abra o link no Safari ou no Chrome.</li>
              <li>iPhone com sistema antigo (antes do iOS 16.4) não recebe notificação de app: atualize em Ajustes → Geral.</li>
            </ul>
            <div style={{ fontSize: 13.5, color: colors.textMuted, lineHeight: 1.5 }}>
              Se não der agora, dá para preencher assim mesmo — só lembre de abrir o app com internet antes de ir para o campo.
            </div>
            <button type="button" onClick={continuarSem} style={botaoSec}>Continuar sem notificação</button>
          </>
        ) : estado === 'negado' ? (
          <>
            {icone(Lock, colors.danger)}
            <div style={{ fontSize: 18, color: colors.text }}>As notificações estão bloqueadas</div>
            <div style={{ fontSize: 14.5, color: colors.textMuted, lineHeight: 1.5 }}>
              Sem elas você não consegue preencher OS: são elas que trazem as suas ordens para o celular sozinhas. Para liberar:
            </div>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14.5, color: colors.text, lineHeight: 1.6 }}>
              <li>Toque no cadeado (ou ⓘ) ao lado do endereço, lá em cima — ou em Configurações do celular → Apps → NT Mecânicos.</li>
              <li>Em <b style={{ fontWeight: 500 }}>Notificações</b>, escolha <b style={{ fontWeight: 500 }}>Permitir</b>.</li>
              <li>Volte aqui e toque em “Já liberei”.</li>
            </ol>
            <button type="button" onClick={() => { setEstado('verificando'); void conferir().then(setEstado) }} style={botao}>Já liberei</button>
            <button type="button" onClick={continuarSem} style={botaoSec}>Continuar sem notificação</button>
          </>
        ) : (
          <>
            {icone(BellRing, colors.primary)}
            <div style={{ fontSize: 18, color: colors.text }}>Ative as notificações para preencher OS</div>
            <div style={{ fontSize: 14.5, color: colors.textMuted, lineHeight: 1.5 }}>
              Com as notificações ligadas, as suas ordens chegam no celular <b style={{ fontWeight: 500 }}>sozinhas</b> — mesmo que você não abra o app na loja — e funcionam no campo sem internet.
            </div>
            <button type="button" onClick={() => void permitir()} style={botao}><BellRing size={18} /> Permitir notificações</button>
            {msg && <div style={{ fontSize: 13.5, color: colors.danger }}>{msg}</div>}
            {tentouSemSucesso && <button type="button" onClick={continuarSem} style={botaoSec}>Continuar sem notificação</button>}
          </>
        )}
      </div>
    </div>
  )
}

/** inscreve/grava no servidor sem travar a tela; se falhar, tenta mais uma vez em 30 s */
async function inscreverEmSegundoPlano(nome: string) {
  try {
    if (await inscreverPush(nome)) return
    setTimeout(() => { void inscreverPush(nome).catch(() => {}) }, 30000)
  } catch { /* segue: a permissão já está dada */ }
}

const botao: React.CSSProperties = { minHeight: 50, borderRadius: 12, border: 'none', background: colors.primary, color: '#fefefe', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }
const botaoSec: React.CSSProperties = { ...botao, background: colors.surface, color: colors.text, border: `1px solid ${colors.border}` }
