export async function register() {
  // The literal NEXT_RUNTIME check is replaced at build time, so the edge bundle drops this
  // import entirely (the warm-up pulls in the SQLite driver, which has no edge build).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWarmup } = await import('./lib/warm')
    startWarmup()
  }
}
