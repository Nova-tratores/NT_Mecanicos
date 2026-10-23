// Tela de teste: não abre em produção (José, 23/10/2026). Pode ser apagada quando não servir mais.
import { notFound } from 'next/navigation'

export default function SoTeste({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound()
  return children
}
