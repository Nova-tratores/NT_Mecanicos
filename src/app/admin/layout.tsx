// Área /admin do app DESLIGADA (José, 23/10/2026): a gestão (técnicos, OS, avisos, Opa, mapa, clientes) é toda
// no Portal. Este layout não mostra mais as telas antigas — qualquer /admin/... cai neste aviso com o link.
// As telas antigas em src/app/admin/** ficam sem uso até serem apagadas.
import { colors } from '@/lib/ui'

const PORTAL = (process.env.NEXT_PUBLIC_PORTAL_URL || 'https://portal.novatratores.com').replace(/\/$/, '')

export default function AdminLayout() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: colors.accentBg }}>
      <div style={{ maxWidth: 420, width: '100%', background: '#fff', borderRadius: 16, padding: 24, textAlign: 'center', color: colors.text }}>
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>A gestão agora é no Portal</div>
        <div style={{ fontSize: 14, color: colors.textMuted, marginBottom: 20 }}>
          Técnicos, ordens de serviço, avisos, Opa e mapa ficam no Portal da Nova Tratores. Use o mesmo login.
        </div>
        <a href={PORTAL} style={{ display: 'inline-block', background: colors.primary, color: '#fff', borderRadius: 12, padding: '12px 20px', textDecoration: 'none', fontSize: 15, fontWeight: 500 }}>
          Abrir o Portal
        </a>
        <div style={{ marginTop: 16 }}>
          <a href="/" style={{ fontSize: 14, color: colors.primary, textDecoration: 'none' }}>Voltar para o app</a>
        </div>
      </div>
    </div>
  )
}
