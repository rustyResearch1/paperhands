'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Nav that says where you are. Every link rendered identically before, so the
 * header gave no clue which of seven sections you were looking at.
 */
export default function NavLinks({ items, variant }: { items: { href: string; label: string }[]; variant: 'header' | 'mobile' }) {
  const pathname = usePathname() ?? '/'
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`))
  if (variant === 'mobile') {
    return (
      <>
        {items.map((n) => {
          const active = isActive(n.href)
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 py-3 text-center text-[12px] font-semibold ${active ? 'text-ink' : 'text-muted'}`}
            >
              {n.label}
            </Link>
          )
        })}
      </>
    )
  }
  return (
    <>
      {items.map((n) => {
        const active = isActive(n.href)
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-3 py-1.5 ${active ? 'bg-bg-2 font-semibold text-ink' : 'text-muted hover:bg-bg-2 hover:text-ink'}`}
          >
            {n.label}
          </Link>
        )
      })}
    </>
  )
}
