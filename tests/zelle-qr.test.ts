import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readZelleQr, zelleQrPath, ZELLE_QR_MAX_BYTES } from '@/lib/zelle'

const dir = mkdtempSync(path.join(tmpdir(), 'zelle-qr-'))
const file = (name: string, bytes: Buffer) => { const p = path.join(dir, name); writeFileSync(p, bytes); return p }
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])

describe('the club Zelle QR code file', () => {
  it('reads a PNG, JPEG or WebP image, typed by its contents', () => {
    expect(readZelleQr(file('a.png', PNG))?.type).toBe('image/png')
    expect(readZelleQr(file('b.jpg', JPEG))?.type).toBe('image/jpeg')
    expect(readZelleQr(file('c.webp', WEBP))?.type).toBe('image/webp')
    // The name does not decide the type.
    expect(readZelleQr(file('d.txt', PNG))?.type).toBe('image/png')
  })

  it('shows nothing when there is no file, or it is not an image', () => {
    expect(readZelleQr(path.join(dir, 'missing.png'))).toBeNull()
    expect(readZelleQr(dir)).toBeNull()
    expect(readZelleQr(file('empty.png', Buffer.alloc(0)))).toBeNull()
    expect(readZelleQr(file('page.png', Buffer.from('<html><script>alert(1)</script>')))).toBeNull()
    expect(readZelleQr(file('svg.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBeNull()
  })

  it('refuses a file far larger than a QR code', () => {
    expect(readZelleQr(file('big.png', Buffer.concat([PNG, Buffer.alloc(ZELLE_QR_MAX_BYTES)])))).toBeNull()
  })

  it('lives in club/zelle-qr.png unless ZELLE_QR_FILE says otherwise', () => {
    const before = process.env.ZELLE_QR_FILE
    delete process.env.ZELLE_QR_FILE
    expect(zelleQrPath()).toBe(path.join(process.cwd(), 'club', 'zelle-qr.png'))
    process.env.ZELLE_QR_FILE = '/srv/qr.png'
    expect(zelleQrPath()).toBe('/srv/qr.png')
    if (before === undefined) delete process.env.ZELLE_QR_FILE
    else process.env.ZELLE_QR_FILE = before
  })
})
