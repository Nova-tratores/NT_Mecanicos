// Robôs do servidor: o código fica em instrumentation-node.ts e só é carregado no runtime nodejs
// (o import dentro do if deixa o webpack de fora no edge — José, 23/10/2026).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ligarRobos } = await import('./instrumentation-node')
    ligarRobos()
  }
}
