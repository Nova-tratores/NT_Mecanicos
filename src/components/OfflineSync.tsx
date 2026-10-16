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
      // Roda a cada 5s: erro do IndexedDB não pode virar rejeição não tratada em loop
      try {
        const count = await getQueueCount()
        setPendentes(count)
        const f = await getFailedItems()
        setFalhas(f.length)
      } catch (e) {
        console.error('[offline-sync] erro ao ler a fila:', e)
      }
    }
    checkQueue()

    // Abriu online com PDFs pendentes (de sessão anterior)? processa em background.
    let pdfTimer: ReturnType<typeof setTimeout> | undefined
    if (navigator.onLine) {
      pdfTimer = setTimeout(() => { processarPdfsPendentes().catch(() => {}) }, 4000)
    }

    const goOnline = async () => {
      setOnline(true)
      setSyncing(true)
      let count = 0
      try {
        count = await processQueue()
        // Depois de subir os dados, gera/anexa o PDF das OS enviadas offline
        await processarPdfsPendentes()
      } catch (e) {
        console.error('[offline-sync] erro ao sincronizar:', e)
      } finally {
        // Sem isso, um erro deixava "Sincronizando dados..." na tela para sempre
        setSyncing(false)
      }
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
        background: '#F59E0B', color: '#fff', padding: 'calc(6px + env(safe-area-inset-top, 0px)) 16px 6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px 8px',
        fontSize: 13, fontWeight: 700, flexWrap: 'wrap', textAlign: 'center',
        animation: 'slideDown 0.3s ease',
      }}>
        <WifiOff size={16} style={{ flexShrink: 0 }} />
        Sem internet — alterações salvas no celular
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
        background: '#2563EB', color: '#fff', padding: 'calc(6px + env(safe-area-inset-top, 0px)) 16px 6px',
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
        background: '#DC2626', color: '#fff', padding: 'calc(8px + env(safe-area-inset-top, 0px)) 16px 8px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        fontSize: 13, fontWeight: 700, flexWrap: 'wrap',
      }}>
        <AlertTriangle size={16} />
        {falhas} envio{falhas > 1 ? 's' : ''} NÃO subi{falhas > 1 ? 'ram' : 'u'} pro portal
        <button
          onClick={async () => {
            if (syncing) return
            if (!navigator.onLine) {
              alert('Sem conexão. Tente de novo quando o sinal voltar.')
              return
            }
            setSyncing(true)
            try {
              const f = await getFailedItems()
              for (const item of f) { if (item.id) await retryFailedItem(item.id) }
              await ressuscitarFalhasDeRede()
              await processQueue()
              await processarPdfsPendentes()
            } catch (e) {
              console.error('[offline-sync] erro ao reenviar:', e)
            } finally {
              setSyncing(false)
            }
            try {
              const rest = await getFailedItems()
              setFalhas(rest.length)
              setPendentes(await getQueueCount())
            } catch {}
          }}
          style={{
            background: '#fff', color: '#DC2626', border: 'none', borderRadius: 8,
            padding: '8px 14px', minHeight: 36, fontSize: 13, fontWeight: 800, cursor: 'pointer',
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
        background: '#059669', color: '#fff', padding: 'calc(6px + env(safe-area-inset-top, 0px)) 16px 6px',
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
