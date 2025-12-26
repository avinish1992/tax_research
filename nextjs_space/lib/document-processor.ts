import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import officeParser from 'officeparser'

// Supported file types
export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'text/plain', // .txt
  'text/markdown', // .md
  'text/html', // .html
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
] as const

export const SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.doc',
  '.txt',
  '.md',
  '.html',
  '.pptx',
  '.xlsx',
] as const

export type SupportedMimeType = typeof SUPPORTED_MIME_TYPES[number]

/**
 * Check if a file type is supported
 */
export function isSupportedFileType(mimeType: string, fileName: string): boolean {
  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'))
  return (
    SUPPORTED_MIME_TYPES.includes(mimeType as SupportedMimeType) ||
    SUPPORTED_EXTENSIONS.includes(extension as typeof SUPPORTED_EXTENSIONS[number])
  )
}

/**
 * Get human-readable list of supported formats
 */
export function getSupportedFormatsText(): string {
  return 'PDF, DOCX, DOC, TXT, MD, PPTX, XLSX'
}

/**
 * Represents text extracted from a document section/page
 */
export interface PageText {
  pageNumber: number
  text: string
}

/**
 * Represents a text chunk with metadata
 */
export interface TextChunk {
  content: string
  pageNumber: number
  chunkIndex: number
}

/**
 * Extract text from Office documents (DOCX, PPTX, XLSX) using officeparser
 * This is a free, open-source solution - no API key required!
 */
export async function extractTextWithOfficeParser(
  buffer: Buffer,
  fileName: string
): Promise<PageText[]> {
  console.log(`Extracting text from ${fileName} using officeparser...`)
  console.log(`  - File size: ${buffer.length} bytes`)

  try {
    // officeparser.parseOfficeAsync returns the text content
    const text = await officeParser.parseOfficeAsync(buffer, {
      newlineDelimiter: '\n',
    })

    if (!text || text.trim().length === 0) {
      throw new Error('No text content found in document')
    }

    console.log(`✓ Text extracted successfully`)
    console.log(`  - Total characters: ${text.length}`)
    console.log(`  - Preview: ${text.substring(0, 100).replace(/\n/g, ' ')}...`)

    // officeparser doesn't provide page numbers, so we treat as single page
    // For better page tracking with PDFs, we use unpdf instead
    return [{
      pageNumber: 1,
      text: text.trim(),
    }]
  } catch (error: any) {
    console.error('❌ Error extracting text with officeparser:', error)
    throw new Error(`Failed to extract text: ${error.message || 'Unknown error'}`)
  }
}

/**
 * Extract text from PDF using unpdf (preserves page numbers)
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<PageText[]> {
  console.log('Extracting text from PDF using unpdf...')
  console.log(`  - File size: ${buffer.length} bytes`)

  try {
    // Dynamic import to avoid bundling issues
    const { extractText } = await import('unpdf')

    const uint8Array = new Uint8Array(buffer)
    const { text, totalPages } = await extractText(uint8Array, {
      mergePages: false,
    })

    const pages: PageText[] = []

    if (Array.isArray(text)) {
      text.forEach((pageText, index) => {
        if (pageText && pageText.trim().length > 0) {
          pages.push({
            pageNumber: index + 1,
            text: pageText.trim(),
          })
        }
      })
    } else {
      const textString = String(text)
      if (textString && textString.trim().length > 0) {
        pages.push({
          pageNumber: 1,
          text: textString.trim(),
        })
      }
    }

    if (pages.length === 0) {
      throw new Error('No text content found in PDF')
    }

    const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0)
    console.log(`✓ Text extracted successfully`)
    console.log(`  - Total pages: ${totalPages}`)
    console.log(`  - Pages with text: ${pages.length}`)
    console.log(`  - Total characters: ${totalChars}`)

    return pages
  } catch (error: any) {
    console.error('❌ Error extracting text from PDF:', error)
    throw new Error(`PDF extraction failed: ${error.message || 'Unknown error'}`)
  }
}

/**
 * Chunk pages using LangChain's RecursiveCharacterTextSplitter
 * Optimized for legal documents with semantic preservation
 */
export async function chunkPages(
  pages: PageText[],
  chunkSize: number = 1000,
  chunkOverlap: number = 150
): Promise<TextChunk[]> {
  try {
    console.log('Chunking document with RecursiveCharacterTextSplitter')
    console.log(`  - Total pages: ${pages.length}`)
    console.log(`  - Chunk size: ${chunkSize} characters (~${Math.floor(chunkSize / 4)} tokens)`)
    console.log(`  - Overlap: ${chunkOverlap} characters`)

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators: [
        '\n\n\n',  // Section breaks
        '\n\n',    // Paragraph breaks
        '\n',      // Line breaks
        '. ',      // Sentence boundaries
        ', ',      // Clause boundaries
        ' ',       // Word boundaries
        '',        // Character-level (last resort)
      ],
    })

    const allChunks: TextChunk[] = []
    let globalChunkIndex = 0

    for (const page of pages) {
      const pageChunks = await splitter.splitText(page.text)

      for (const chunkContent of pageChunks) {
        allChunks.push({
          content: chunkContent,
          pageNumber: page.pageNumber,
          chunkIndex: globalChunkIndex++,
        })
      }
    }

    console.log(`✓ Text chunked successfully`)
    console.log(`  - Total chunks: ${allChunks.length}`)
    if (allChunks.length > 0) {
      console.log(`  - Avg chunk size: ${Math.floor(allChunks.reduce((sum, c) => sum + c.content.length, 0) / allChunks.length)} chars`)
    }

    return allChunks
  } catch (error) {
    console.error('❌ Error chunking document:', error)
    throw error
  }
}

/**
 * Extract text from plain text file
 */
export function extractTextFromPlainText(buffer: Buffer, fileName: string): PageText[] {
  const text = buffer.toString('utf-8').trim()

  if (!text) {
    throw new Error('File is empty')
  }

  console.log(`Extracted ${text.length} characters from ${fileName}`)

  return [{
    pageNumber: 1,
    text,
  }]
}

/**
 * Smart extraction - automatically chooses the best method based on file type
 * Uses open-source libraries only - NO API keys required!
 */
export async function smartExtractText(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<PageText[]> {
  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'))

  // Plain text files - direct extraction
  if (mimeType === 'text/plain' || extension === '.txt') {
    console.log('Using direct text extraction for plain text file')
    return extractTextFromPlainText(buffer, fileName)
  }

  // Markdown files - direct extraction
  if (mimeType === 'text/markdown' || extension === '.md') {
    console.log('Using direct text extraction for markdown file')
    return extractTextFromPlainText(buffer, fileName)
  }

  // HTML files - direct extraction (basic)
  if (mimeType === 'text/html' || extension === '.html') {
    console.log('Using direct text extraction for HTML file')
    // Strip HTML tags for basic text extraction
    const html = buffer.toString('utf-8')
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return [{ pageNumber: 1, text }]
  }

  // PDF files - use unpdf for page-level extraction
  if (mimeType === 'application/pdf' || extension === '.pdf') {
    console.log('Using unpdf for PDF extraction (preserves page numbers)')
    return extractTextFromPDF(buffer)
  }

  // Office documents (DOCX, PPTX, XLSX) - use officeparser
  const officeExtensions = ['.docx', '.doc', '.pptx', '.xlsx', '.xls', '.odt', '.odp', '.ods']
  if (officeExtensions.includes(extension)) {
    console.log('Using officeparser for Office document extraction')
    return extractTextWithOfficeParser(buffer, fileName)
  }

  // Fallback: try officeparser for unknown formats
  console.log('Attempting extraction with officeparser for unknown format')
  return extractTextWithOfficeParser(buffer, fileName)
}
