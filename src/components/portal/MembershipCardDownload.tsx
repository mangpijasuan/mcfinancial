import { useState } from 'react'
import { Download } from 'lucide-react'
import '@fontsource/allura/400.css'
import { button } from './kit'

const CARD_ARTWORK = '/brand/membership-card.webp'
const SERIF = 'Georgia, "Times New Roman", serif'
const SIGNATURE = 'Allura, cursive'

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  font: string,
) {
  context.font = font
  context.fillText(text, x, y, width)
}

export default function MembershipCardDownload({
  fullName,
  memberId,
  joinYear,
}: {
  fullName: string
  memberId: string
  joinYear: number
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
      drawText(context, fullName, 109, 421, 510, `bold 68px ${SERIF}`)
      drawText(context, memberId, 118, 554, 399, `bold 51px ${SERIF}`)
      drawText(context, String(joinYear), 634, 554, 260, `bold 53px ${SERIF}`)
      drawText(context, fullName, 94, 823, 322, `68px ${SIGNATURE}`)

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
      <button type="button" className={button.ghostDark} onClick={downloadCard} disabled={pending}>
        <Download size={16} aria-hidden />
        {pending ? 'Preparing membership card…' : 'Download membership card'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-white">Could not download your card. Please try again.</p>}
    </div>
  )
}
