'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Viewer, Worker } from '@react-pdf-viewer/core'
import { highlightPlugin, RenderHighlightsProps, HighlightArea } from '@react-pdf-viewer/highlight'
import '@react-pdf-viewer/core/lib/styles/index.css'
import '@react-pdf-viewer/highlight/lib/styles/index.css'

interface PDFViewerWithHighlightProps {
  url: string
  pageNumber?: number
  highlightText?: string
  fileName?: string
  onClose?: () => void
}

// Fetch PDF as blob to avoid CORS issues
async function fetchPdfAsBlob(url: string): Promise<ArrayBuffer> {
  console.log('[PDFHighlight] Fetching PDF as blob...')
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF: ${response.status}`)
  }
  return response.arrayBuffer()
}

// Find text in PDF and calculate bounding box for highlighting
async function findTextBoundingBox(
  pdfUrl: string,
  targetText: string,
  pageNumber: number
): Promise<HighlightArea[]> {
  console.log('[PDFHighlight] findTextBoundingBox called:', {
    pdfUrl: pdfUrl.substring(0, 100) + '...',
    targetTextLength: targetText?.length,
    targetTextPreview: targetText?.substring(0, 50),
    pageNumber
  })

  if (!targetText || targetText.length < 20) {
    console.log('[PDFHighlight] Target text too short, skipping')
    return []
  }

  try {
    // Dynamically import pdfjs to avoid SSR issues
    const pdfjs = await import('pdfjs-dist')

    // Set worker source
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js'

    console.log('[PDFHighlight] Loading PDF document...')

    // Fetch PDF as ArrayBuffer to avoid CORS issues with signed URLs
    let pdf
    try {
      const pdfData = await fetchPdfAsBlob(pdfUrl)
      console.log('[PDFHighlight] Fetched PDF as blob:', pdfData.byteLength, 'bytes')
      pdf = await pdfjs.getDocument({ data: pdfData }).promise
    } catch (fetchError) {
      console.error('[PDFHighlight] Failed to fetch PDF as blob, trying direct URL:', fetchError)
      // Fallback to direct URL (may work if CORS is configured)
      try {
        pdf = await pdfjs.getDocument(pdfUrl).promise
        console.log('[PDFHighlight] Direct load succeeded')
      } catch (directError) {
        console.error('[PDFHighlight] Direct load also failed:', directError)
        return []
      }
    }
    console.log('[PDFHighlight] PDF loaded, pages:', pdf.numPages)
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const viewport = page.getViewport({ scale: 1 })

    // Build full page text and track character positions
    interface TextItemPosition {
      str: string
      transform: number[]
      width: number
      height: number
      itemIndex: number
    }

    const textItems: TextItemPosition[] = textContent.items
      .filter((item): boolean => 'str' in item && typeof (item as { str?: string }).str === 'string')
      .map((item, index) => {
        const textItem = item as { str: string; transform: number[]; width: number; height: number }
        return {
          str: textItem.str,
          transform: textItem.transform,
          width: textItem.width,
          height: textItem.height,
          itemIndex: index
        }
      })

    // Build full text string from all items
    let fullText = ''
    const charToItem: { itemIndex: number; charIndex: number }[] = []

    textItems.forEach((item, itemIdx) => {
      for (let charIdx = 0; charIdx < item.str.length; charIdx++) {
        charToItem.push({ itemIndex: itemIdx, charIndex: charIdx })
        fullText += item.str[charIdx]
      }
      // Add space between items
      charToItem.push({ itemIndex: itemIdx, charIndex: -1 })
      fullText += ' '
    })

    // Normalize text for matching (collapse whitespace, remove special chars)
    const normalizeText = (text: string) => {
      return text
        .replace(/\s+/g, ' ')  // Collapse whitespace
        .replace(/[^\w\s]/g, '') // Remove punctuation for better matching
        .trim()
        .toLowerCase()
    }

    // Strip leading list markers, Roman numerals, and document artifacts
    const stripLeadingArtifacts = (text: string) => {
      // Remove leading Roman numerals (i, ii, iii, iv, v, vi, vii, viii, ix, x, etc.)
      // Also remove leading letters (a, b, c) and numbers (1, 2, 3)
      return text
        .replace(/^(i{1,3}|iv|v|vi{0,3}|ix|x{1,3}|[a-z]|[0-9]+)\s+/i, '')  // Leading markers
        .replace(/^[\d.)\]]+\s*/g, '')  // Leading numbers with dots/brackets
        .trim()
    }

    const normalizedTarget = normalizeText(targetText).substring(0, 300)
    const cleanedTarget = stripLeadingArtifacts(normalizedTarget)  // Also try without leading artifacts
    const normalizedFull = normalizeText(fullText)

    console.log('[PDFHighlight] Searching for match...')
    console.log('[PDFHighlight] Normalized target (first 100):', normalizedTarget.substring(0, 100))
    console.log('[PDFHighlight] Normalized full (first 300):', normalizedFull.substring(0, 300))

    // Find the best matching position using multiple strategies
    let matchStart = -1
    let matchLength = 0

    // Strategy 1: Full match (first 300 chars)
    matchStart = normalizedFull.indexOf(normalizedTarget)
    if (matchStart !== -1) {
      matchLength = normalizedTarget.length
      console.log('[PDFHighlight] Full match found at position:', matchStart)
    }

    // Strategy 2: Try first 150 chars
    if (matchStart === -1) {
      const target150 = normalizedTarget.substring(0, 150)
      matchStart = normalizedFull.indexOf(target150)
      if (matchStart !== -1) {
        matchLength = target150.length
        console.log('[PDFHighlight] 150-char match found at position:', matchStart)
      }
    }

    // Strategy 3: Try first 80 chars
    if (matchStart === -1) {
      const target80 = normalizedTarget.substring(0, 80)
      matchStart = normalizedFull.indexOf(target80)
      if (matchStart !== -1) {
        matchLength = target80.length
        console.log('[PDFHighlight] 80-char match found at position:', matchStart)
      }
    }

    // Strategy 4: Try first 40 chars (most flexible)
    if (matchStart === -1) {
      const target40 = normalizedTarget.substring(0, 40)
      matchStart = normalizedFull.indexOf(target40)
      if (matchStart !== -1) {
        matchLength = Math.min(target40.length * 3, normalizedTarget.length) // Extend highlight
        console.log('[PDFHighlight] 40-char match found at position:', matchStart)
      }
    }

    // Strategy 5: Try finding key phrases (split by common words)
    if (matchStart === -1) {
      const words = normalizedTarget.split(' ').filter(w => w.length > 4)
      const keyPhrase = words.slice(0, 5).join(' ')
      if (keyPhrase.length > 20) {
        matchStart = normalizedFull.indexOf(keyPhrase)
        if (matchStart !== -1) {
          matchLength = Math.min(keyPhrase.length * 2, 200)
          console.log('[PDFHighlight] Key phrase match found at position:', matchStart, 'phrase:', keyPhrase)
        }
      }
    }

    // Strategy 6: Try with cleaned target (stripped leading artifacts like "ii", "a)", "1.")
    if (matchStart === -1 && cleanedTarget !== normalizedTarget) {
      console.log('[PDFHighlight] Trying cleaned target (first 80):', cleanedTarget.substring(0, 80))

      // Try full cleaned target
      matchStart = normalizedFull.indexOf(cleanedTarget.substring(0, 200))
      if (matchStart !== -1) {
        matchLength = Math.min(200, cleanedTarget.length)
        console.log('[PDFHighlight] Cleaned target match found at position:', matchStart)
      }

      // Try first 80 chars of cleaned target
      if (matchStart === -1) {
        const cleanedTarget80 = cleanedTarget.substring(0, 80)
        matchStart = normalizedFull.indexOf(cleanedTarget80)
        if (matchStart !== -1) {
          matchLength = Math.min(cleanedTarget80.length * 2, 150)
          console.log('[PDFHighlight] Cleaned 80-char match found at position:', matchStart)
        }
      }

      // Try first 40 chars of cleaned target
      if (matchStart === -1) {
        const cleanedTarget40 = cleanedTarget.substring(0, 40)
        matchStart = normalizedFull.indexOf(cleanedTarget40)
        if (matchStart !== -1) {
          matchLength = Math.min(cleanedTarget40.length * 3, 150)
          console.log('[PDFHighlight] Cleaned 40-char match found at position:', matchStart)
        }
      }
    }

    // Strategy 7: Look for distinctive phrases (skip first words, try middle content)
    if (matchStart === -1) {
      const words = cleanedTarget.split(' ')
      if (words.length > 10) {
        // Try words 5-15 (skip possible header/intro text)
        const middlePhrase = words.slice(5, 15).join(' ')
        if (middlePhrase.length > 30) {
          matchStart = normalizedFull.indexOf(middlePhrase)
          if (matchStart !== -1) {
            matchLength = Math.min(middlePhrase.length * 2, 200)
            console.log('[PDFHighlight] Middle phrase match found at position:', matchStart, 'phrase:', middlePhrase.substring(0, 50))
          }
        }
      }
    }

    // Strategy 8: Find any substantial word sequence (last resort)
    if (matchStart === -1) {
      const words = cleanedTarget.split(' ').filter(w => w.length > 3)
      for (let i = 0; i < Math.min(words.length - 3, 10); i++) {
        const phrase = words.slice(i, i + 4).join(' ')
        if (phrase.length > 15) {
          matchStart = normalizedFull.indexOf(phrase)
          if (matchStart !== -1) {
            matchLength = Math.min(phrase.length * 3, 150)
            console.log('[PDFHighlight] Word sequence match found at position:', matchStart, 'phrase:', phrase)
            break
          }
        }
      }
    }

    // Strategy 9: Handle calculation-heavy content (like "AED 375,000 x 0% = AED 0")
    // Skip numeric/calculation portions and find substantive text
    if (matchStart === -1) {
      // Remove leading calculations/numbers and find the first substantive text phrase
      const calcCleaned = cleanedTarget
        .replace(/^[\d\s%x=aed.,()+-]+/gi, '')  // Remove leading calcs
        .replace(/^(the\s+)?portion\s+of\s+/i, '')  // Common phrase after calcs
        .trim()

      if (calcCleaned.length > 30) {
        const calcPhrase = calcCleaned.substring(0, 60)
        matchStart = normalizedFull.indexOf(calcPhrase)
        if (matchStart !== -1) {
          matchLength = Math.min(calcPhrase.length * 2, 150)
          console.log('[PDFHighlight] Calc-cleaned match found at position:', matchStart, 'phrase:', calcPhrase.substring(0, 50))
        }
      }
    }

    // Strategy 10: Try looking for key distinctive phrases anywhere in content
    if (matchStart === -1) {
      // Look for distinctive legal/tax phrases that are likely unique
      const distinctivePhrases = [
        'taxable income exceeding',
        'taxable income not exceeding',
        'corporate tax at',
        'subject to corporate tax',
        'tax period',
        'resident person',
        'qualifying free zone',
        'small business relief'
      ]

      for (const phrase of distinctivePhrases) {
        if (cleanedTarget.includes(phrase)) {
          matchStart = normalizedFull.indexOf(phrase)
          if (matchStart !== -1) {
            matchLength = Math.min(100, normalizedFull.length - matchStart)
            console.log('[PDFHighlight] Distinctive phrase match found:', phrase)
            break
          }
        }
      }
    }

    if (matchStart === -1) {
      console.log('[PDFHighlight] No text match found!')
      return []
    }

    console.log('[PDFHighlight] Match found at position:', matchStart, 'length:', matchLength)

    // Calculate match end based on matched length
    const matchEnd = Math.min(
      matchStart + matchLength,
      charToItem.length - 1
    )

    // Find all text items that are part of the match
    const matchedItemIndices: number[] = []
    for (let i = matchStart; i < matchEnd && i < charToItem.length; i++) {
      if (charToItem[i].charIndex !== -1) {
        const idx = charToItem[i].itemIndex
        if (!matchedItemIndices.includes(idx)) {
          matchedItemIndices.push(idx)
        }
      }
    }

    if (matchedItemIndices.length === 0) return []

    // Limit to first 8 text items max (approximately 2-3 lines of text)
    // to avoid highlighting the entire page
    const limitedItems = matchedItemIndices.slice(0, 8)
    console.log('[PDFHighlight] Matched items:', matchedItemIndices.length, 'limited to:', limitedItems.length)

    // Calculate bounding box from matched items
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    limitedItems.forEach(itemIdx => {
      const item = textItems[itemIdx]
      if (!item) return

      // transform[4] = x position, transform[5] = y position
      const x = item.transform[4]
      const y = item.transform[5]
      const width = item.width
      const height = Math.abs(item.transform[0]) // Font size approximation

      minX = Math.min(minX, x)
      minY = Math.min(minY, y - height)
      maxX = Math.max(maxX, x + width)
      maxY = Math.max(maxY, y + 5) // Small padding
    })

    // Convert to percentage-based coordinates (required by highlightPlugin)
    const area: HighlightArea = {
      pageIndex: pageNumber - 1,
      left: (minX / viewport.width) * 100,
      top: ((viewport.height - maxY) / viewport.height) * 100,
      width: ((maxX - minX) / viewport.width) * 100,
      height: ((maxY - minY) / viewport.height) * 100,
    }

    // Validate bounds
    if (area.left < 0 || area.top < 0 || area.width <= 0 || area.height <= 0) {
      return []
    }

    // Clamp to page bounds and limit height to max 20% of page (about 4-5 lines)
    area.left = Math.max(0, Math.min(100, area.left))
    area.top = Math.max(0, Math.min(100, area.top))
    area.width = Math.min(100 - area.left, area.width)
    area.height = Math.min(20, Math.min(100 - area.top, area.height)) // Max 20% height

    console.log('[PDFHighlight] Final highlight area:', area)
    return [area]
  } catch (error) {
    console.error('[PDFHighlight] Error finding text bounding box:', error)
    return []
  }
}

// Inner component that creates the plugin - isolated to prevent hook order issues
interface PDFViewerInnerProps {
  url: string
  pageNumber: number
  highlightAreas: HighlightArea[]
  onError: (error: string) => void
}

function PDFViewerInner({
  url,
  pageNumber,
  highlightAreas,
  onError
}: PDFViewerInnerProps) {
  // Store highlight areas in a ref that the render function can access
  const areasRef = useRef<HighlightArea[]>(highlightAreas)

  // Update ref synchronously before render
  areasRef.current = highlightAreas

  // Create plugin instance directly in component body (NOT in useMemo - highlightPlugin uses hooks internally)
  const highlightPluginInstance = highlightPlugin({
    renderHighlights: (props: RenderHighlightsProps) => {
      const pageAreas = areasRef.current.filter(area => area.pageIndex === props.pageIndex)
      console.log('[PDFHighlight] renderHighlights called, page:', props.pageIndex, 'areas:', pageAreas.length)

      return (
        <div>
          {pageAreas.map((area, idx) => {
            const cssProps = props.getCssProperties(area, props.rotation)
            console.log('[PDFHighlight] Rendering highlight', idx, 'css:', cssProps)
            return (
              <div
                key={idx}
                style={{
                  ...cssProps,
                  backgroundColor: 'rgba(255, 235, 59, 0.5)',
                  position: 'absolute',
                  borderRadius: '2px',
                  pointerEvents: 'none',
                  border: '2px solid rgba(255, 193, 7, 0.8)',
                  zIndex: 10,
                }}
              />
            )
          })}
        </div>
      )
    },
  })

  return (
    <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js">
      <div style={{ height: '100%' }}>
        <Viewer
          fileUrl={url}
          initialPage={pageNumber - 1}
          defaultScale={1}
          plugins={[highlightPluginInstance]}
          renderError={() => {
            onError('Failed to load PDF. The document may be corrupted or inaccessible.')
            return (
              <div className="flex flex-col items-center justify-center p-8">
                <p className="text-sm text-muted-foreground">Failed to load PDF</p>
              </div>
            )
          }}
          renderLoader={(percentages: number) => (
            <div className="flex flex-col items-center justify-center p-8 h-full">
              <div className="w-8 h-8 border-2 border-muted-foreground/20 border-t-primary rounded-full animate-spin" />
              <p className="mt-3 text-sm text-muted-foreground">
                Loading PDF... {Math.round(percentages)}%
              </p>
            </div>
          )}
        />
      </div>
    </Worker>
  )
}

export function PDFViewerWithHighlight({
  url,
  pageNumber = 1,
  highlightText,
  // fileName and onClose kept for API compatibility but not used in compact mode
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fileName: _fileName,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onClose: _onClose
}: PDFViewerWithHighlightProps) {
  const [error, setError] = useState<string | null>(null)
  const [highlightAreas, setHighlightAreas] = useState<HighlightArea[]>([])
  const [viewerKey, setViewerKey] = useState(0)

  // Find text position and create highlight areas when component mounts or props change
  useEffect(() => {
    console.log('[PDFHighlight] useEffect triggered:', {
      hasUrl: !!url,
      hasHighlightText: !!highlightText,
      highlightTextLength: highlightText?.length,
      pageNumber
    })

    if (!highlightText || !url) {
      console.log('[PDFHighlight] Missing url or highlightText, skipping')
      setHighlightAreas([])
      return
    }

    let cancelled = false

    ;(async () => {
      try {
        console.log('[PDFHighlight] Calling findTextBoundingBox...')
        const areas = await findTextBoundingBox(url, highlightText, pageNumber)
        console.log('[PDFHighlight] Got areas:', areas.length, areas)
        if (!cancelled) {
          setHighlightAreas(areas)
          // Force viewer re-render to show highlights
          if (areas.length > 0) {
            console.log('[PDFHighlight] Forcing viewer re-render for highlights')
            setViewerKey(prev => prev + 1)
          }
        }
      } catch (err) {
        console.error('[PDFHighlight] Failed to find highlight area:', err)
        if (!cancelled) {
          setHighlightAreas([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [url, highlightText, pageNumber])

  const handleError = (errorMsg: string) => {
    setError(errorMsg)
  }

  return (
    <div className="flex flex-col h-full bg-muted/30">
      {/* Highlight indicator */}
      {highlightText && highlightAreas.length > 0 && (
        <div className="flex-shrink-0 px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 border-b border-yellow-200 dark:border-yellow-800/50">
          <p className="text-xs text-yellow-800 dark:text-yellow-200 flex items-center gap-2">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span>Source text highlighted on this page</span>
          </p>
        </div>
      )}

      {/* PDF Content */}
      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center text-center p-8 h-full">
            <svg className="w-12 h-12 text-destructive/50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : (
          <PDFViewerInner
            key={`pdf-viewer-${viewerKey}-${highlightAreas.length}`}
            url={url}
            pageNumber={pageNumber}
            highlightAreas={highlightAreas}
            onError={handleError}
          />
        )}
      </div>

      {/* Global styles for PDF viewer */}
      <style jsx global>{`
        /* PDF viewer container styles */
        .rpv-core__viewer {
          height: 100%;
        }

        .rpv-core__inner-pages {
          background-color: transparent !important;
        }

        .rpv-core__page-layer {
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
          margin: 1rem auto;
        }

        /* Highlight layer should be above text layer */
        .rpv-highlight__container {
          z-index: 2;
        }

        /* Hide default toolbar from react-pdf-viewer */
        .rpv-core__toolbar,
        .rpv-toolbar,
        .rpv-default-layout__toolbar,
        .rpv-core__inner-container > div:first-child:not(.rpv-core__inner-pages) {
          display: none !important;
        }

        /* Hide any default page navigation at the bottom */
        .rpv-page-navigation__current-page-input,
        .rpv-page-navigation,
        .rpv-zoom__popover-target,
        .rpv-core__page-navigation {
          display: none !important;
        }
      `}</style>
    </div>
  )
}

export default PDFViewerWithHighlight
