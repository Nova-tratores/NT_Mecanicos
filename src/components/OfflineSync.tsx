'use client'
import { useEffect, useState } from 'react'
import { startAutoSync, sincronizarTudo, ressuscitarFalhasDeRede, onSyncEstado } from '@/lib/syncManager'
import { getQueueCount, getFailedItems, retryFailedItem } from '@/lib/offlineCache'
import { Wifi, WifiOff, Upload, AlertTriangle } from 'lucide-react'

// Um fluxo só (José, 23/10/2026): quem sobe a fila e depois gera os PDFs é o syncManager (sincronizarTudo).
// Esta faixa só mostra o estado — antes ela rodava um segundo processQueue no 'online', que voltava 0 na hora
// (o outro já estava rodando), e o aviso de sucesso nunca aparecia.

export default function OfflineSync() {
  const [online, setOnline] = useState(true)
  const [pendentes, setPendentes] = useState(0)
  const [falhas, setFalhas] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    setOnline(navigator.onLine)

    const checkQueue = async () => {
      const count = await getQueueCount()
      setPendentes(count)
      const f = await getFailedItems()
      setFalhas(f.length)
    }
    checkQueue()

    let bannerTimer: ReturnType<typeof setTimeout> | undefined
    const tirar = onSyncEstado(async (e) => {
      // "Enviando para o portal…" só quando há algo na fila (aparecia em toda abertura do app)
      if (e.rodando) { if ((await getQueueCount()) > 0) setSyncing(true); return }
      setSyncing(false)
      await checkQueue()
      if (e.enviados > 0) {
        setShowBanner(true)
        if (bannerTimer) clearTimeout(bannerTimer)
        bannerTimer = setTimeout(() => setShowBanner(false), 3000)
      }
    })
    // registra depois de ouvir o estado, para a primeira rodada já aparecer
    startAutoSync()

    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // Checar fila periodicamente
    const interval = setInterval(checkQueue, 5000)

    return () => {
      tirar()
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      clearInterval(interval)
      if (bannerTimer) clearTimeout(bannerTimer)
    }
  }, [])

  // Banner de offline
  if (!online) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: '#F59E0B', color: '#fff', padding: '6px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontSize: 13, fontWeight: 500,
        animation: 'slideDown 0.3s ease',
      }}>
        <WifiOff size={16} />
        Sem internet — o que você salvar fica no celular e sobe depois
        {pendentes > 0 && (
          <span style={{
            background: 'rgba(255,255,255,0.3)', borderRadius: 10,
            padding: '1px 8px', fontSize: 11,
          }}>
            {pendentes} pendente{pendentes > 1 ? 's' : ''}
          </span>
        )}
      </div>
    )
  }

  // Banner de sync
  if (syncing) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: '#2563EB', color: '#fff', padding: '6px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontSize: 13, fontWeight: 500,
      }}>
        <Upload size={16} className="spinner" />
        Enviando para o portal...
      </div>
    )
  }

  // Banner VERMELHO: envio preso no aparelho (falha permanente) — antes isso
  // ficava invisível e o relatório nunca chegava no portal (caso OS-0670).
  if (falhas > 0 && !syncing) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: '#DC2626', color: '#fff', padding: '8px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        fontSize: 13, fontWeight: 500, flexWrap: 'wrap',
      }}>
        <AlertTriangle size={16} />
        {falhas} envio{falhas > 1 ? 's' : ''} não subi{falhas > 1 ? 'ram' : 'u'} para o portal
        <button
          onClick={async () => {
            const f = await getFailedItems()
            for (const item of f) { if (item.id) await retryFailedItem(item.id) }
            await ressuscitarFalhasDeRede()
            await sincronizarTudo()
            const rest = await getFailedItems()
            setFalhas(rest.length)
            setPendentes(await getQueueCount())
          }}
          style={{
            background: '#fff', color: '#DC2626', border: 'none', borderRadius: 8,
            padding: '4px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
          }}
        >
          Tentar de novo
        </button>
      </div>
    )
  }

  // Banner de sucesso
  if (showBanner) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: '#059669', color: '#fff', padding: '6px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontSize: 13, fontWeight: 500,
      }}>
        <Wifi size={16} />
        Dados enviados para o portal
      </div>
    )
  }

  return null
}
