import type { NextRequest } from 'next/server'
import { bump } from './counters'

/** Fixed-window per-IP limiter for the public API. In-memory: one box, fine for v1. */
const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(req: NextRequest, limitPerMinute = 60): { ok: boolean; remaining: number; resetAt: number } {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local'
  const now = Date.now()
  let b = buckets.get(ip)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + 60_000 }
    buckets.set(ip, b)
  }
  b.count++
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
  }
  const ok = b.count <= limitPerMinute
  // Every public endpoint passes through here, so this is where usage is counted.
  if (ok) bump(req.nextUrl.pathname.split('/').filter(Boolean).join('.'))
  return { ok, remaining: Math.max(0, limitPerMinute - b.count), resetAt: b.resetAt }
}

export function limitHeaders(r: { remaining: number; resetAt: number }): Record<string, string> {
  return { 'X-RateLimit-Remaining': String(r.remaining), 'X-RateLimit-Reset': String(Math.ceil(r.resetAt / 1000)), 'Cache-Control': 'no-store' }
}
