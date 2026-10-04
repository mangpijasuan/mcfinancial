'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html>
      <body className="bg-gray-50 min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-xs">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-600 mb-4">
            The app hit an unexpected runtime error. Try reloading this screen.
          </p>
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg bg-[#1B2A4A] text-white text-sm font-medium hover:bg-[#243660]"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
