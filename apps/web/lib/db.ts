import { openDb } from '@paperhands/indexer/db'
import type Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = process.env.PAPERHANDS_DB ?? path.resolve(process.cwd(), '..', '..', 'data', 'paperhands.sqlite')

const g = globalThis as unknown as { __phdb?: Database.Database }
export const db: Database.Database = (g.__phdb ??= openDb(dbPath))
