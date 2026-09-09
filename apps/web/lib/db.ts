import { openDb } from '@paperhands/indexer/db'
import type Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = process.env.PAPERHANDS_DB ?? path.resolve(process.cwd(), '..', '..', 'data', 'paperhands.sqlite')

const g = globalThis as unknown as { __phdb?: Database.Database }
export const db: Database.Database = (g.__phdb ??= open())

function open(): Database.Database {
  // openDb sets busy_timeout itself, before its own schema writes — the indexer
  // shares this file and occasionally holds the write lock for seconds (prunes,
  // big ticks), and several `next build` workers open it at once.
  return openDb(dbPath)
}
