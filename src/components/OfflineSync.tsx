'use client'
import { useEffect, useState } from 'react'
import { startAutoSync, processQueue, ressuscitarFalhasDeRede } from '@/lib/syncManager'
import { getQueueCount, getPendingPdfs, removePendingPdf, getFailedItems, retryFailedItem } from '@/lib/offlineCache'
import { gerarEAnexarRelatorio } from '@/lib/gerarEAnexarRelatorio'
import { Wifi, WifiOff, Upload, AlertTriangle } from 'lucide-react'

// Gera/anexa o PDF das OS enviadas offline (roda depois que a fila sobe os dados)
async function processarPdfsPendentes() {
  if (!navigator.onLine) return
  const list = await getPendingPdfs()
  for (const osId of list) {
    try {
      const ok = await gerarEAnexarRelatorio(osId)
      if (ok) await removePendingPdf(osId)
    } catch { /* tenta de novo na proxima reconexao */ }
  }
}

export default function OfflineSync() {
  const [online, setOnline] = useState(true)
  const [pendentes, setPendentes] = useState(0)
  const [falhas, setFalhas] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    setOnline(navigator.onLine)
    startAutoSync()

    const checkQueue = async () => {
      const count = await getQueueCount()
      setPendentes(count)
      const f = await getFailedItems()
      setFalhas(f.length)
    }
    checkQueue()

    // Abriu online com PDFs pendentes (de sessão anterior)? processa em background.
    let pdfTimer: ReturnType<typeof setTimeout> | undefined
    if (navigator.onLine) {
      pdfTimer = setTimeout(() => { processarPdfsPendentes() }, 4000)
    }

    const goOnline = async () => {
      setOnline(true)
      setSyncing(true)
      const count = await processQueue()
      // Depois de subir os dados, gera/anexa o PDF das OS enviadas offline
      await processarPdfsPendentes()
      setSyncing(false)
      await checkQueue()
      if (count > 0) {
        setShowBanner(true)
        setTimeout(() => setShowBanner(false), 3000)
      }
    }

    const goOffline = () => {
      setOnline(false)
    }

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)

    // Checar fila periodicamente
    const interval = setInterval(checkQueue, 5000)

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      clearInterval(interval)
      if (pdfTimer) clearTimeout(pdfTimer)
    }
  }, [])

  // Banner de offline
  if (!online) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: '#F59E0B', color: '#fff', padding: '6px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontSize: 13, fontWeight: 700,
        animation: 'slideDown 0.3s ease',
      }}>
        <WifiOff size={16} />
        Sem internet — alterações serão salvas localmente
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
        fontSize: 13, fontWeight: 700,
      }}>
        <Upload size={16} className="spinner" />
        Sincronizando dados...
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
        fontSize: 13, fontWeight: 700, flexWrap: 'wrap',
      }}>
        <AlertTriangle size={16} />
        {falhas} envio{falhas > 1 ? 's' : ''} NÃO subi{falhas > 1 ? 'ram' : 'u'} pro portal
        <button
          onClick={async () => {
            setSyncing(true)
            const f = await getFailedItems()
            for (const item of f) { if (item.id) await retryFailedItem(item.id) }
            await ressuscitarFalhasDeRede()
            await processQueue()
            await processarPdfsPendentes()
            setSyncing(false)
            const rest = await getFailedItems()
            setFalhas(rest.length)
            setPendentes(await getQueueCount())
          }}
          style={{
            background: '#fff', color: '#DC2626', border: 'none', borderRadius: 8,
            padding: '4px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
          }}
        >
          TENTAR DE NOVO
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
        fontSize: 13, fontWeight: 700,
      }}>
        <Wifi size={16} />
        Dados sincronizados com sucesso!
      </div>
    )
  }

  return null
}
