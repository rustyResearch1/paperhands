import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  transpilePackages: ['@paperhands/engine', '@paperhands/chain', '@paperhands/indexer'],
  webpack: (config) => {
    // workspace packages use ESM ".js" specifiers that resolve to .ts sources
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }
    return config
  },
}

export default nextConfig
