import path from 'node:path'
import { NextRequest } from 'next/server'

const API_DIR = path.resolve(__dirname, '../../src/app/api')

type CallOptions = {
  params?: Record<string, string>
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
  query?: string
}

/** Calls an App Router route handler directly, e.g. callRoute('payments/[id]/confirm', 'POST', { params: { id } }). */
export async function callRoute(route: string, method: string, opts: CallOptions = {}) {
  const mod = await import(path.join(API_DIR, route, 'route.ts'))
  const handler = mod[method]
  if (typeof handler !== 'function') throw new Error(`${route} does not export ${method}`)

  let urlPath = route
  for (const [key, value] of Object.entries(opts.params ?? {})) urlPath = urlPath.replace(`[${key}]`, value)
  const url = `http://localhost/api/${urlPath}${opts.query ? `?${opts.query}` : ''}`

  const init: Record<string, unknown> = { method, headers: { 'content-type': 'application/json', ...opts.headers } }
  if (opts.rawBody !== undefined) init.body = opts.rawBody
  else if (opts.body !== undefined) init.body = JSON.stringify(opts.body)

  const res: Response = await handler(new NextRequest(url, init as any), { params: Promise.resolve(opts.params ?? {}) })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, text, headers: res.headers }
}
