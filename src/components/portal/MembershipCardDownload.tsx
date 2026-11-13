import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import '@fontsource/allura/400.css'
import { button } from './kit'

const CARD_ARTWORK = '/brand/membership-card.webp'
const SERIF = 'Georgia, "Times New Roman", serif'
const SIGNATURE = 'Allura, cursive'

/**
 * The four lines drawn on the card artwork, in its own 1536 x 967 pixels:
 * where each goes and the most width it may take. A line too long for its
 * space is squeezed to fit, by the download and the preview alike.
 */
type Line = { key: string; x: number; y: number; width: number; size: number; bold: boolean; family: string }
const LINES: Line[] = [
  { key: 'name', x: 109, y: 421, width: 510, size: 68, bold: true, family: SERIF },
  { key: 'id', x: 118, y: 554, width: 399, size: 51, bold: true, family: SERIF },
  { key: 'since', x: 634, y: 554, width: 260, size: 53, bold: true, family: SERIF },
  { key: 'signature', x: 94, y: 823, width: 322, size: 68, bold: false, family: SIGNATURE },
]
const canvasFont = (l: Line) => `${l.bold ? 'bold ' : ''}${l.size}px ${l.family}`
const textOf = (l: Line, t: { fullName: string; memberId: string; joinYear: number }) =>
  l.key === 'id' ? t.memberId : l.key === 'since' ? String(t.joinYear) : t.fullName

/** How wide each line is when drawn, once the fonts are loaded; only lines wider than their space need squeezing. */
function useSqueeze(t: { fullName: string; memberId: string; joinYear: number }) {
  const [squeeze, setSqueeze] = useState<Record<string, number>>({})
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await Promise.all(LINES.map((l) => document.fonts.load(canvasFont(l), textOf(l, t))))
        const context = document.createElement('canvas').getContext('2d')
        if (!context || cancelled) return
        const next: Record<string, number> = {}
        for (const l of LINES) {
          context.font = canvasFont(l)
          if (context.measureText(textOf(l, t)).width > l.width) next[l.key] = l.width
        }
        setSqueeze(next)
      } catch {
        // No font loading here: the lines show at their natural width.
      }
    })()
    return () => { cancelled = true }
  }, [t.fullName, t.memberId, t.joinYear]) // eslint-disable-line react-hooks/exhaustive-deps
  return squeeze
}

/**
 * The member's card as it will download: the same artwork with the name, ID
 * and year drawn at the same places, and squeezed to the same widths.
 */
export function MembershipCardPreview({ fullName, memberId, joinYear }: { fullName: string; memberId: string; joinYear: number }) {
  const squeeze = useSqueeze({ fullName, memberId, joinYear })
  return (
    <svg viewBox="0 0 1536 967" role="img" aria-label={`Membership card for ${fullName}, ${memberId}, member since ${joinYear}`}
      className="block h-auto w-full rounded-xl shadow-md ring-1 ring-black/10">
      <image href={CARD_ARTWORK} x="0" y="0" width="1536" height="967" />
      {LINES.map((l) => (
        <text key={l.key} data-line={l.key} x={l.x} y={l.y} fontSize={l.size} fill="#fffaf2" fontFamily={l.family}
          fontWeight={l.bold ? 'bold' : undefined}
          textLength={squeeze[l.key]} lengthAdjust={squeeze[l.key] ? 'spacingAndGlyphs' : undefined}>
          {textOf(l, { fullName, memberId, joinYear })}
        </text>
      ))}
    </svg>
  )
}

export default function MembershipCardDownload({
  fullName,
  memberId,
  joinYear,
  tone = 'dark',
}: {
  fullName: string
  memberId: string
  joinYear: number
  /** On the dark welcome card, or on a white card. */
  tone?: 'dark' | 'light'
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  async function downloadCard() {
    setPending(true)
    setError(false)

    try {
      const artwork = new Image()
      artwork.src = CARD_ARTWORK
      await Promise.all([artwork.decode(), document.fonts.load('68px Allura', fullName)])

      const canvas = document.createElement('canvas')
      canvas.width = artwork.naturalWidth
      canvas.height = artwork.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Card rendering unavailable')
      context.drawImage(artwork, 0, 0)
      context.fillStyle = '#fffaf2'
      for (const l of LINES) {
        context.font = canvasFont(l)
        context.fillText(textOf(l, { fullName, memberId, joinYear }), l.x, l.y, l.width)
      }

      const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!png) throw new Error('Card export unavailable')
      const url = URL.createObjectURL(png)
      const link = document.createElement('a')
      link.href = url
      link.download = `Millionaires-Club-${memberId.replace(/[^a-z0-9_-]/gi, '_')}.png`
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <button type="button" className={tone === 'dark' ? button.ghostDark : button.secondary} onClick={downloadCard} disabled={pending}>
        <Download size={16} aria-hidden />
        {pending ? 'Preparing membership card…' : 'Download membership card'}
      </button>
      {error && <p role="alert" className={tone === 'dark' ? 'mt-2 text-sm text-white' : 'mt-2 text-sm text-red-700'}>Could not download your card. Please try again.</p>}
    </div>
  )
}
