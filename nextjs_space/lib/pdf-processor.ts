import { extractText } from 'unpdf'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

/**
 * Represents text extracted from a single page
 */
export interface PageText {
  pageNumber: number
  text: string
}

/**
 * Extract text from PDF page-by-page using unpdf
 * Returns array of page texts with page numbers for metadata tracking
 */
export async function extractTextFromPDF(buffer: Buffer): Promise<PageText[]> {
  // Check buffer size (max 10MB)
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error('PDF file too large for text extraction. Please use a smaller file (max 10MB).')
  }
  
  try {
    console.log('Extracting text from PDF using unpdf, size:', buffer.length, 'bytes')
    
    // Convert Buffer to Uint8Array for unpdf compatibility
    const uint8Array = new Uint8Array(buffer)
    
    // Extract text using unpdf - get pages as array
    const { text, totalPages } = await extractText(uint8Array, {
      mergePages: false, // Keep pages separate for page tracking
    })
    
    // Convert to PageText array
    const pages: PageText[] = []
    
    if (Array.isArray(text)) {
      // Text is already page-by-page array
      text.forEach((pageText, index) => {
        if (pageText && pageText.trim().length > 0) {
          pages.push({
            pageNumber: index + 1, // 1-indexed
            text: pageText.trim()
          })
        }
      })
    } else {
      // Single string - treat as one page
      const textString = String(text) // Explicit conversion for type safety
      if (textString && textString.trim().length > 0) {
        pages.push({
          pageNumber: 1,
          text: textString.trim()
        })
      }
    }
    
    if (pages.length === 0) {
      throw new Error('No text content found in PDF. The PDF might be image-based or corrupted.')
    }
    
    const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0)
    
    console.log('✓ Text extracted successfully')
    console.log('  - Total pages:', totalPages)
    console.log('  - Pages with text:', pages.length)
    console.log('  - Total text length:', totalChars, 'characters')
    console.log('  - First page preview:', pages[0].text.substring(0, 100).replace(/\n/g, ' '))
    
    return pages
  } catch (error) {
    console.error('❌ Error extracting text from PDF:', error)
    if (error instanceof Error) {
      throw new Error(`PDF text extraction failed: ${error.message}`)
    }
    throw error
  }
}

/**
 * Represents a text chunk with page metadata
 */
export interface TextChunk {
  content: string
  pageNumber: number
  chunkIndex: number
}

/**
 * Chunk pages using LangChain's RecursiveCharacterTextSplitter with page tracking
 * Optimized for legal documents with semantic preservation and page-level citations
 * 
 * @param pages - Array of page texts with page numbers
 * @param chunkSize - Target chunk size in characters (default: 1000 for ~250 tokens)
 * @param chunkOverlap - Overlap between chunks in characters (default: 150 for ~15% overlap)
 * @returns Array of chunks with page numbers and content
 */
export async function chunkPages(
  pages: PageText[], 
  chunkSize: number = 1000, 
  chunkOverlap: number = 150
): Promise<TextChunk[]> {
  try {
    console.log('Chunking pages with RecursiveCharacterTextSplitter')
    console.log('  - Total pages:', pages.length)
    console.log('  - Chunk size:', chunkSize, 'characters (~', Math.floor(chunkSize / 4), 'tokens)')
    console.log('  - Overlap:', chunkOverlap, 'characters (~', Math.floor(chunkOverlap / chunkSize * 100), '%)')
    
    // Create text splitter optimized for legal documents
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: chunkSize,
      chunkOverlap: chunkOverlap,
      // Separators optimized for legal documents (preserve sections and paragraphs)
      separators: [
        '\n\n\n',  // Multiple newlines (section breaks)
        '\n\n',    // Paragraph breaks
        '\n',      // Line breaks
        '. ',      // Sentence boundaries
        ', ',      // Clause boundaries
        ' ',       // Word boundaries
        '',        // Character-level (last resort)
      ],
    })
    
    // Process pages and track which page each chunk came from
    const allChunks: TextChunk[] = []
    let globalChunkIndex = 0
    
    for (const page of pages) {
      console.log(`  - Processing page ${page.pageNumber} (${page.text.length} chars)...`)
      
      // Chunk this page
      const pageChunks = await splitter.splitText(page.text)
      
      // Add page metadata to each chunk
      for (const chunkContent of pageChunks) {
        allChunks.push({
          content: chunkContent,
          pageNumber: page.pageNumber,
          chunkIndex: globalChunkIndex++
        })
      }
      
      console.log(`    → Generated ${pageChunks.length} chunks from page ${page.pageNumber}`)
    }
    
    console.log('✓ Text chunked successfully with page tracking')
    console.log('  - Total chunks:', allChunks.length)
    console.log('  - Avg chunk size:', Math.floor(allChunks.reduce((sum, c) => sum + c.content.length, 0) / allChunks.length), 'chars')
    console.log('  - Min chunk size:', Math.min(...allChunks.map(c => c.content.length)), 'chars')
    console.log('  - Max chunk size:', Math.max(...allChunks.map(c => c.content.length)), 'chars')
    console.log('  - Page range:', Math.min(...allChunks.map(c => c.pageNumber)), '-', Math.max(...allChunks.map(c => c.pageNumber)))
    
    return allChunks
  } catch (error) {
    console.error('❌ Error chunking pages:', error)
    throw error
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use chunkPages() with page tracking instead
 */
export async function chunkText(
  text: string, 
  chunkSize: number = 1000, 
  chunkOverlap: number = 150
): Promise<string[]> {
  console.warn('⚠️ chunkText() is deprecated. Use chunkPages() for page tracking.')
  
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ['\n\n\n', '\n\n', '\n', '. ', ', ', ' ', ''],
  })
  
  return await splitter.splitText(text)
}
