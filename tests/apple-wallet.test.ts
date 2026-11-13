// Apple Wallet membership passes (docs/operations/apple-wallet.md): a pass
// is built and signed from the member's record. Signed here with a
// throwaway certificate authority standing in for Apple's, so the test
// proves the pass library (and the joi version it runs on) works end to end.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { appleWalletConfig, createMembershipPass } from '@/lib/appleWallet'

const openssl = (dir: string, ...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' })
let certs: string

beforeAll(() => {
  certs = mkdtempSync(join(tmpdir(), 'wallet-certs-'))
  // A stand-in for Apple's intermediate, and a pass certificate it issued.
  openssl(certs, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca-key.pem', '-out', 'wwdr.pem', '-days', '2', '-subj', '/CN=Test WWDR')
  openssl(certs, 'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'signer-key.pem', '-out', 'signer.csr', '-subj', '/CN=Pass Type ID: pass.us.mcfinancial.test')
  openssl(certs, 'x509', '-req', '-in', 'signer.csr', '-CA', 'wwdr.pem', '-CAkey', 'ca-key.pem', '-CAcreateserial', '-out', 'signer-cert.pem', '-days', '2')
})
afterAll(() => rmSync(certs, { recursive: true, force: true }))
afterEach(() => vi.unstubAllEnvs())

describe('Apple Wallet settings', () => {
  it('needs a pass type ID starting "pass." and a 10-character team ID', () => {
    vi.stubEnv('APPLE_WALLET_PASS_TYPE_ID', '')
    vi.stubEnv('APPLE_WALLET_TEAM_ID', '')
    expect(appleWalletConfig()).toBeNull()
    vi.stubEnv('APPLE_WALLET_PASS_TYPE_ID', 'us.mcfinancial.membership')
    vi.stubEnv('APPLE_WALLET_TEAM_ID', 'ABCDE12345')
    expect(appleWalletConfig()).toBeNull()
    vi.stubEnv('APPLE_WALLET_PASS_TYPE_ID', ' pass.us.mcfinancial.membership ')
    vi.stubEnv('APPLE_WALLET_TEAM_ID', 'abc')
    expect(appleWalletConfig()).toBeNull()
    vi.stubEnv('APPLE_WALLET_TEAM_ID', 'ABCDE12345')
    expect(appleWalletConfig()).toEqual({ passTypeIdentifier: 'pass.us.mcfinancial.membership', teamIdentifier: 'ABCDE12345' })
  })
})

describe('a membership pass', () => {
  it('carries the member’s name, ID and join year, and is signed', async () => {
    const pass = await createMembershipPass(
      { passTypeIdentifier: 'pass.us.mcfinancial.test', teamIdentifier: 'ABCDE12345' },
      { id: 'MC-10001', legalName: 'Ada Example', joinDate: new Date('2014-01-05T00:00:00Z') },
      certs,
    )
    const out = mkdtempSync(join(tmpdir(), 'wallet-pass-'))
    try {
      writeFileSync(join(out, 'member.pkpass'), pass)
      execFileSync('unzip', ['-q', 'member.pkpass'], { cwd: out })
      const listed = execFileSync('unzip', ['-Z1', 'member.pkpass'], { cwd: out }).toString().trim().split('\n').sort()
      expect(listed).toEqual(['icon.png', 'icon@2x.png', 'icon@3x.png', 'manifest.json', 'pass.json', 'signature'])

      const json = JSON.parse(readFileSync(join(out, 'pass.json'), 'utf8'))
      expect(json).toMatchObject({
        formatVersion: 1, passTypeIdentifier: 'pass.us.mcfinancial.test', teamIdentifier: 'ABCDE12345', serialNumber: 'MC-10001',
        organizationName: 'MC Financial', description: 'Millionaires Club Membership',
        generic: {
          primaryFields: [{ key: 'member-name', value: 'Ada Example' }],
          secondaryFields: [{ key: 'member-id', value: 'MC-10001' }],
          auxiliaryFields: [{ key: 'member-since', value: '2014' }],
        },
      })
      // The manifest lists every file's SHA-1, and the signature over it checks out against the issuer.
      const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
      expect(Object.keys(manifest).sort()).toEqual(['icon.png', 'icon@2x.png', 'icon@3x.png', 'pass.json'])
      openssl(out, 'smime', '-verify', '-binary', '-inform', 'DER', '-in', 'signature', '-content', 'manifest.json',
        '-CAfile', join(certs, 'wwdr.pem'), '-purpose', 'any', '-out', '/dev/null')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('fails when the signing files are missing', async () => {
    await expect(createMembershipPass(
      { passTypeIdentifier: 'pass.us.mcfinancial.test', teamIdentifier: 'ABCDE12345' },
      { id: 'MC-10001', legalName: 'Ada Example', joinDate: new Date('2014-01-05T00:00:00Z') },
      join(certs, 'missing'),
    )).rejects.toThrow()
  })
})
