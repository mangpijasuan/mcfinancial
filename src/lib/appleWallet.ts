import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PKPass } from 'passkit-generator'

const credentialDirectory = join(process.cwd(), 'club', 'wallet')
const iconDirectory = join(process.cwd(), 'public', 'brand', 'wallet')

export function appleWalletConfig() {
  const passTypeIdentifier = process.env.APPLE_WALLET_PASS_TYPE_ID?.trim()
  const teamIdentifier = process.env.APPLE_WALLET_TEAM_ID?.trim()
  if (!passTypeIdentifier?.startsWith('pass.') || !teamIdentifier || !/^[A-Z0-9]{10}$/.test(teamIdentifier)) {
    return null
  }
  return { passTypeIdentifier, teamIdentifier }
}

export async function createMembershipPass(
  config: NonNullable<ReturnType<typeof appleWalletConfig>>,
  member: { id: string; legalName: string; joinDate: Date },
  /** Where the signing files are; the club's read-only mount unless a test gives its own. */
  credentials: string = credentialDirectory,
) {
  const [wwdr, signerCert, signerKey, icon, icon2x, icon3x] = await Promise.all([
    readFile(join(credentials, 'wwdr.pem')),
    readFile(join(credentials, 'signer-cert.pem')),
    readFile(join(credentials, 'signer-key.pem')),
    readFile(join(iconDirectory, 'icon.png')),
    readFile(join(iconDirectory, 'icon@2x.png')),
    readFile(join(iconDirectory, 'icon@3x.png')),
  ])
  const pass = new PKPass({
    'pass.json': Buffer.from(JSON.stringify({ generic: {} })),
    'icon.png': icon,
    'icon@2x.png': icon2x,
    'icon@3x.png': icon3x,
  }, { wwdr, signerCert, signerKey, signerKeyPassphrase: process.env.APPLE_WALLET_KEY_PASSPHRASE || undefined }, {
    ...config,
    formatVersion: 1,
    serialNumber: member.id,
    organizationName: 'MC Financial',
    description: 'Millionaires Club Membership',
    logoText: 'Millionaires Club',
    foregroundColor: 'rgb(255, 255, 255)',
    backgroundColor: 'rgb(9, 29, 54)',
    labelColor: 'rgb(240, 203, 111)',
  })

  pass.primaryFields.push({ key: 'member-name', label: 'MEMBER NAME', value: member.legalName })
  pass.secondaryFields.push({ key: 'member-id', label: 'MEMBER ID', value: member.id })
  pass.auxiliaryFields.push({ key: 'member-since', label: 'MEMBER SINCE', value: String(member.joinDate.getUTCFullYear()) })
  return pass.getAsBuffer()
}
