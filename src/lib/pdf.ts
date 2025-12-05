/**
 * PDF Processing utilities
 * 
 * Converts PDF pages to images for OCR processing via GPT-4o Vision.
 * Uses pdf-to-img which is based on pdfjs-dist.
 * 
 * OPTIMIZED: Processes pages in parallel for faster results.
 */

import { pdf } from 'pdf-to-img';
import { preprocessImageToBase64 } from './image.js';
import { analyzeImageWithGPT } from './openai.js';
import type { PdfPageResult, TokenUsage } from '../types.js';

// Maximum concurrent API calls
// OpenAI Tier 1: 500 RPM, Tier 2+: 5000+ RPM
// 50 concurrent is safe for Tier 2+ accounts
const MAX_CONCURRENT_PAGES = 50;

// System prompt for PDF OCR with structured JSON output
const PDF_OCR_SYSTEM_PROMPT = `You are a high-accuracy OCR AI that extracts content from document images and outputs structured JSON.

OUTPUT FORMAT - Return valid JSON with this structure:
{
  "elements": [
    {"type": "heading", "level": 1, "text": "..."},
    {"type": "paragraph", "text": "..."},
    {"type": "list", "style": "bullet|number", "items": ["...", "..."]},
    {"type": "table", "description": "brief description", "headers": [...], "rows": [[...], [...]]},
    {"type": "graph", "description": "detailed description of what the graph shows, axes, data trends"},
    {"type": "image", "description": "detailed description of the image/diagram"},
    {"type": "question", "number": "1", "text": "...", "options": [{"label": "A", "text": "..."}, ...]},
    {"type": "code", "language": "...", "text": "..."},
    {"type": "equation", "text": "..."}
  ]
}

RULES:
- Extract EVERY piece of text - do NOT skip anything
- Identify element types accurately (heading, paragraph, table, graph, question, etc.)
- For graphs/charts: describe what they show, axes labels, data trends, key values
- For images/diagrams: describe in detail what is depicted
- For tables: extract headers and all row data
- For questions/tests: identify question numbers, text, and all answer options
- For multi-column: read left to right, top to bottom
- Return ONLY valid JSON, no other text`;

const PDF_OCR_USER_PROMPT = `Extract ALL content from this PDF page as structured JSON. Include every element (text, tables, graphs, images, questions). For visual elements, provide detailed descriptions:`;

/**
 * Convert a PDF buffer to an array of page image buffers
 * 
 * @param buffer - PDF file buffer
 * @returns Array of PNG image buffers, one per page
 */
export async function pdfBufferToPageImages(buffer: Buffer): Promise<Buffer[]> {
  const pageImages: Buffer[] = [];
  
  try {
    // pdf-to-img returns an async generator of page images
    const document = await pdf(buffer, {
      scale: 2.0, // Higher scale for better OCR accuracy
    });
    
    for await (const image of document) {
      // image is a Buffer containing PNG data
      pageImages.push(image);
    }
    
    return pageImages;
  } catch (error) {
    console.error('[PDF] Failed to convert PDF to images:', error);
    throw new Error('Invalid PDF file or unable to render pages');
  }
}

/**
 * Process a single PDF page image
 * 
 * @param pageBuffer - PNG image buffer for the page
 * @param pageNumber - 1-indexed page number
 * @returns Page result with extracted text and usage
 */
async function processPageImage(
  pageBuffer: Buffer,
  pageNumber: number
): Promise<PdfPageResult> {
  try {
    console.log(`[PDF] Processing page ${pageNumber}...`);
    
    // Preprocess the image (resize, convert to base64)
    const { base64 } = await preprocessImageToBase64(pageBuffer);
    
    // Analyze with GPT-4o Vision
    const { text, usage } = await analyzeImageWithGPT({
      imageBase64: base64,
      systemPrompt: PDF_OCR_SYSTEM_PROMPT,
      userPrompt: PDF_OCR_USER_PROMPT,
    });
    
    console.log(`[PDF] Page ${pageNumber} done: ${text.length} chars, ${usage.total_tokens} tokens`);
    
    return {
      page: pageNumber,
      text,
      usage,
    };
  } catch (error) {
    console.error(`[PDF] Error processing page ${pageNumber}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      page: pageNumber,
      text: `[PAGE ${pageNumber} ERROR: ${errorMessage}]`,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      },
    };
  }
}

/**
 * Process pages in parallel with concurrency limit
 * 
 * @param pageImages - Array of page image buffers
 * @param concurrency - Maximum concurrent requests
 * @returns Array of page results in order
 */
async function processPagesConcurrently(
  pageImages: Buffer[],
  concurrency: number = MAX_CONCURRENT_PAGES
): Promise<PdfPageResult[]> {
  const results: PdfPageResult[] = new Array(pageImages.length);
  let currentIndex = 0;
  
  // Create worker function that processes pages
  async function worker(): Promise<void> {
    while (currentIndex < pageImages.length) {
      const index = currentIndex++;
      const pageNumber = index + 1;
      results[index] = await processPageImage(pageImages[index], pageNumber);
    }
  }
  
  // Start workers up to concurrency limit
  const workers: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, pageImages.length);
  
  console.log(`[PDF] Starting ${workerCount} parallel workers for ${pageImages.length} pages`);
  
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  
  // Wait for all workers to complete
  await Promise.all(workers);
  
  return results;
}

/**
 * Process an entire PDF file
 * 
 * Converts each page to an image, runs OCR via GPT-4o Vision IN PARALLEL,
 * and returns results for all pages with aggregated token usage.
 * 
 * @param buffer - PDF file buffer
 * @returns Array of page results and total token usage
 */
export async function processPdfBuffer(buffer: Buffer): Promise<{
  pages: PdfPageResult[];
  totals: TokenUsage;
}> {
  const startTime = Date.now();
  
  // Convert PDF to page images
  console.log('[PDF] Converting PDF to images...');
  const pageImages = await pdfBufferToPageImages(buffer);
  console.log(`[PDF] Found ${pageImages.length} page(s)`);
  
  if (pageImages.length === 0) {
    throw new Error('PDF contains no pages');
  }
  
  // Process pages in parallel
  const pages = await processPagesConcurrently(pageImages, MAX_CONCURRENT_PAGES);
  
  // Aggregate usage
  const totals: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
  
  for (const page of pages) {
    totals.input_tokens += page.usage.input_tokens;
    totals.output_tokens += page.usage.output_tokens;
    totals.total_tokens += page.usage.total_tokens;
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[PDF] All ${pages.length} pages processed in ${duration}s. Total tokens: ${totals.total_tokens}`);
  
  return { pages, totals };
}
