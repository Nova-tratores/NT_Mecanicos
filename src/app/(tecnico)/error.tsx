'use client'
import { useEffect } from 'react'

export default function TecnicoError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => { console.error('[tecnico] erro de renderização:', error) }, [error])
  const offline = typeof navigator !== 'undefined' && !navigator.onLine
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#111' }}>
        Erro ao carregar a página
      </h2>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 24, maxWidth: 300, lineHeight: 1.5 }}>
        {offline
          ? 'Você está sem conexão. Toque em "Tentar novamente" quando o sinal voltar.'
          : 'Algo deu errado. Tente novamente — se continuar, limpe o cache.'}
        {error.digest && <span style={{ display: 'block', fontSize: 11, color: '#999', marginTop: 8 }}>Código: {error.digest}</span>}
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={reset}
          style={{
            padding: '12px 24px', borderRadius: 12, border: 'none',
            background: '#1E3A5F', color: '#fff', fontSize: 14, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Tentar novamente
        </button>
        <button
          onClick={async () => {
            // Espera apagar antes de recarregar (antes recarregava com o cache antigo ainda lá)
            try {
              if ('caches' in window) {
                const keys = await caches.keys()
                await Promise.all(keys.map(k => caches.delete(k)))
              }
            } catch {}
            window.location.reload()
          }}
          style={{
            padding: '12px 24px', borderRadius: 12,
            border: '1px solid #ddd', background: '#fff', color: '#333',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Limpar cache
        </button>
      </div>
    </div>
  )
}
