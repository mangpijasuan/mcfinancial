// The public site (apps/web): static pages served by Caddy, never the app.
// Every link and image resolves, nothing runs or collects anything, and no
// page describes lending, investment or the token before counsel clears the
// wording (product map §5; compliance rows 2, 3 and 17; MCTN after Gate #2).
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', 'apps', 'web', 'public')
const PAGES = readdirSync(ROOT).filter((f) => f.endsWith('.html'))
const html = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const text = (file: string) => html(file).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const attrs = (file: string, name: 'href' | 'src') => [...html(file).matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1])

// A path on the site: the file itself, or the page Caddy serves for it (/about → about.html).
function resolves(path: string): boolean {
  const clean = path.split('#')[0]
  if (clean === '/') return existsSync(join(ROOT, 'index.html'))
  return existsSync(join(ROOT, clean)) || existsSync(join(ROOT, `${clean}.html`))
}

describe('the public site', () => {
  it('has its pages', () => {
    expect(PAGES.sort()).toEqual(['404.html', 'about.html', 'contact.html', 'index.html', 'membership.html'])
  })

  it.each(PAGES)('%s: a title, a description, and the same header and footer', (file) => {
    const page = html(file)
    expect(page).toMatch(/^<!doctype html>\n<html lang="en">/)
    expect(page).toMatch(/<title>[^<]*Millionaires Club<\/title>/)
    expect(page).toMatch(/<meta name="description" content="[^"]{20,}">/)
    expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    for (const link of ['/', '/about', '/membership', '/contact', '/sign-in']) expect(attrs(file, 'href'), link).toContain(link)
  })

  it.each(PAGES)('%s: every link and image goes somewhere', (file) => {
    for (const ref of [...attrs(file, 'href'), ...attrs(file, 'src')]) {
      if (ref === '/sign-in' || ref === '#main') continue // Caddy sends /sign-in to the member app
      expect(ref.startsWith('/'), `${ref}: links stay on the site`).toBe(true)
      expect(resolves(ref), ref).toBe(true)
    }
  })

  it.each(PAGES)('%s: no scripts, inline styles or forms (the security policy allows none)', (file) => {
    const page = html(file)
    expect(page).not.toMatch(/<script|<style|\sstyle="|\son[a-z]+="|<form|<iframe/i)
  })

  it.each(PAGES)('%s: nothing about lending, investment or the token until counsel clears it', (file) => {
    const forbidden = /\b(loans?|lend\w*|borrow\w*|credit|interest|invest\w*|returns?|profits?|dividends?|yields?|earn\w*|guarantee\w*|tokens?|mctn|crypto\w*|blockchain|financial services)\b/i
    expect(text(file).match(forbidden)?.[0] ?? null).toBeNull()
  })

  it('the web server serves the site on its own address and sends sign-in to the member app', () => {
    const caddy = readFileSync(join(__dirname, '..', 'Caddyfile'), 'utf8')
    const site = caddy.slice(caddy.indexOf('{$WWW_DOMAIN'))
    expect(site).toContain('root * {$WWW_ROOT:/srv/www}')
    expect(site).toContain('redir /sign-in https://{$APP_DOMAIN}/portal/login 302')
    expect(site).toContain("Content-Security-Policy \"default-src 'none'")
    expect(site).not.toContain('reverse_proxy') // never the app
    expect(readFileSync(join(__dirname, '..', 'docker-compose.hetzner.yml'), 'utf8')).toContain('./apps/web/public:/srv/www:ro')
  })
})
