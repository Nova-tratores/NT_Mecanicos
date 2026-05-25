'use client'

export default function TecnicoError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#111' }}>
        Erro ao carregar a pagina
      </h2>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 24, maxWidth: 300 }}>
        {error.message || 'Algo deu errado. Tente recarregar.'}
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
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
          onClick={() => {
            if ('caches' in window) {
              caches.keys().then(keys => keys.forEach(k => caches.delete(k)))
            }
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
