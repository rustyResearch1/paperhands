import type Database from 'better-sqlite3'
import { createReadStream, createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

/**
 * Durable storage, kept deliberately simple:
 * 1. Online SQLite backup (safe under WAL) → gzip → ./backups/, keep last 8.
 * 2. If R2/S3 env is configured, the same file also goes to the bucket —
 *    Cloudflare R2's free tier (10 GB) fits years of ledgers.
 *
 * Restore = gunzip a snapshot and point PAPERHANDS_DB at it.
 * Env: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
 */
export async function runBackup(db: Database.Database, dbPath: string, keep = 8): Promise<string> {
  const dir = join(dirname(dbPath), '..', 'backups')
  mkdirSync(dir, { recursive: true })
  const stampName = `paperhands-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)}`
  const raw = join(dir, `${stampName}.sqlite`)
  const gz = `${raw}.gz`

  await db.backup(raw)
  await pipeline(createReadStream(raw), createGzip({ level: 6 }), createWriteStream(gz))
  unlinkSync(raw)

  const snapshots = readdirSync(dir)
    .filter((f) => f.startsWith('paperhands-') && f.endsWith('.sqlite.gz'))
    .sort()
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - keep))) {
    unlinkSync(join(dir, old))
  }

  const uploaded = await uploadToR2(gz).catch((err) => {
    console.error('backup: R2 upload failed —', (err as Error).message.split('\n')[0])
    return false
  })
  const size = (statSync(gz).size / 1e6).toFixed(1)
  console.log(`backup: ${gz} (${size} MB)${uploaded ? ' → R2 ✓' : ''}`)
  return gz
}

async function uploadToR2(file: string): Promise<boolean> {
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return false
  let S3: typeof import('@aws-sdk/client-s3')
  try {
    S3 = await import('@aws-sdk/client-s3')
  } catch {
    console.error('backup: R2 env set but @aws-sdk/client-s3 not installed — pnpm add @aws-sdk/client-s3')
    return false
  }
  const client = new S3.S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  })
  const { readFileSync } = await import('node:fs')
  const key = `backups/${file.split('/').pop()}`
  await client.send(
    new S3.PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: readFileSync(file) }),
  )
  return true
}
