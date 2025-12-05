/**
 * Vision API Routes
 * 
 * Handles image upload and OCR processing via GPT-4o Vision.
 * Requires authentication and tracks usage/billing.
 */

import { Router } from 'express';
import multer from 'multer';
import { preprocessImageToBase64 } from '../lib/image.js';
import { analyzeImageWithGPT, isOpenAIConfigured } from '../lib/openai.js';
import { processPdfBuffer } from '../lib/pdf.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { calculateCost } from '../lib/billing.js';
import { deductBalance, logUsage, getUserProfile } from '../lib/supabase.js';
import type { VisionAnalyzeResponse, PdfAnalyzeResponse, ErrorResponse } from '../types.js';

// Configure multer for memory storage (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max file size
  },
  fileFilter: (_req, file, cb) => {
    // Accept images and PDFs
    const allowedMimes = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/gif',
      'image/heic',
      'application/pdf',
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// System prompt for high-accuracy OCR with structured JSON output
const OCR_SYSTEM_PROMPT = `You are a high-accuracy OCR AI that extracts content from images and outputs structured JSON.

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
- For handwritten text: transcribe as accurately as possible, use [?] for uncertain parts
- Return ONLY valid JSON, no other text`;

// User prompt for text extraction
const OCR_USER_PROMPT = `Extract ALL content from this image as structured JSON. Include every element (text, tables, graphs, images, questions). For visual elements, provide detailed descriptions:`;

// Create router
const router = Router();

/**
 * POST /api/vision/analyze-image
 * 
 * Upload an image for OCR processing via GPT-4o Vision.
 * Requires authentication and deducts from user balance.
 * 
 * Request: multipart/form-data with 'file' field
 * Response: JSON with extracted text, token usage, image dimensions, and cost
 */
router.post('/analyze-image', requireAuth, upload.single('file'), async (req, res) => {
  try {
    // Check OpenAI configuration
    if (!isOpenAIConfigured()) {
      const error: ErrorResponse = {
        error: 'OpenAI API key not configured',
        details: 'Set OPENAI_API_KEY environment variable',
      };
      return res.status(500).json(error);
    }
    
    // Ensure file is present
    if (!req.file) {
      const error: ErrorResponse = {
        error: 'No file uploaded',
        details: 'Please provide a file in the "file" field',
      };
      return res.status(400).json(error);
    }
    
    // Check user balance (minimum $0.01)
    if (req.user!.profile.balance < 0.01) {
      return res.status(402).json({
        error: 'Insufficient balance',
        message: 'Please top up your account to continue',
        balance: req.user!.profile.balance,
      });
    }
    
    console.log(`[Vision] Processing file: ${req.file.originalname} (${req.file.mimetype}, ${Math.round(req.file.size / 1024)}KB) for user ${req.user!.email}`);
    
    // Preprocess the image
    const { base64, width, height } = await preprocessImageToBase64(req.file.buffer);
    
    // Analyze with GPT-4o Vision
    const { text, usage } = await analyzeImageWithGPT({
      imageBase64: base64,
      systemPrompt: OCR_SYSTEM_PROMPT,
      userPrompt: OCR_USER_PROMPT,
    });
    
    // Calculate cost (2x markup)
    const cost = calculateCost(usage);
    
    // Deduct from user balance
    const { success, newBalance } = await deductBalance(req.user!.id, cost.chargedCost);
    
    if (!success) {
      console.error(`[Vision] Failed to deduct balance for user ${req.user!.id}`);
    }
    
    // Log usage
    await logUsage(
      req.user!.id,
      '/api/vision/analyze-image',
      usage.input_tokens,
      usage.output_tokens,
      cost.apiCost,
      req.file.originalname,
      'image'
    );
    
    // Build response
    const response: VisionAnalyzeResponse = {
      text,
      usage,
      image: { width, height },
      cost: cost.chargedCost,
      balance: newBalance,
    };
    
    console.log(`[Vision] Success! Extracted ${text.length} chars, cost: $${cost.chargedCost.toFixed(4)}, new balance: $${newBalance.toFixed(4)}`);
    
    return res.json(response);
    
  } catch (error) {
    console.error('[Vision] Error:', error);
    
    const errorResponse: ErrorResponse = {
      error: 'Failed to process image',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
    
    return res.status(500).json(errorResponse);
  }
});

/**
 * POST /api/vision/analyze-pdf
 * 
 * Upload a PDF for OCR processing via GPT-4o Vision.
 * Each page is converted to an image and processed separately.
 * Requires authentication and deducts from user balance.
 * 
 * Request: multipart/form-data with 'file' field (PDF only)
 * Response: JSON with extracted text per page, aggregated token usage, and cost
 */
router.post('/analyze-pdf', requireAuth, upload.single('file'), async (req, res) => {
  try {
    // Check OpenAI configuration
    if (!isOpenAIConfigured()) {
      const error: ErrorResponse = {
        error: 'OpenAI API key not configured',
        details: 'Set OPENAI_API_KEY environment variable',
      };
      return res.status(500).json(error);
    }
    
    // Ensure file is present
    if (!req.file) {
      const error: ErrorResponse = {
        error: 'No file uploaded',
        details: 'Please provide a PDF file in the "file" field',
      };
      return res.status(400).json(error);
    }
    
    // Validate PDF mime type
    if (req.file.mimetype !== 'application/pdf') {
      const error: ErrorResponse = {
        error: 'Invalid file type',
        details: `Expected PDF, got ${req.file.mimetype}`,
      };
      return res.status(400).json(error);
    }
    
    // Check user balance (minimum $0.05 for PDFs)
    if (req.user!.profile.balance < 0.05) {
      return res.status(402).json({
        error: 'Insufficient balance',
        message: 'Please top up your account to continue',
        balance: req.user!.profile.balance,
      });
    }
    
    console.log(`[PDF] Processing file: ${req.file.originalname} (${Math.round(req.file.size / 1024)}KB) for user ${req.user!.email}`);
    
    // Process the PDF
    const { pages, totals } = await processPdfBuffer(req.file.buffer);
    
    // Calculate cost (2x markup)
    const cost = calculateCost(totals);
    
    // Deduct from user balance
    const { success, newBalance } = await deductBalance(req.user!.id, cost.chargedCost);
    
    if (!success) {
      console.error(`[PDF] Failed to deduct balance for user ${req.user!.id}`);
    }
    
    // Log usage
    await logUsage(
      req.user!.id,
      '/api/vision/analyze-pdf',
      totals.input_tokens,
      totals.output_tokens,
      cost.apiCost,
      req.file.originalname,
      'pdf'
    );
    
    // Build response
    const response: PdfAnalyzeResponse = {
      pages,
      totals,
      cost: cost.chargedCost,
      balance: newBalance,
    };
    
    console.log(`[PDF] Success! Processed ${pages.length} pages, cost: $${cost.chargedCost.toFixed(4)}, new balance: $${newBalance.toFixed(4)}`);
    
    return res.json(response);
    
  } catch (error) {
    console.error('[PDF] Error:', error);
    
    // Check if it's a PDF parsing error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isPdfError = errorMessage.includes('Invalid PDF') || 
                       errorMessage.includes('unable to render') ||
                       errorMessage.includes('no pages');
    
    const errorResponse: ErrorResponse = {
      error: isPdfError ? 'Invalid PDF file' : 'Failed to process PDF',
      details: errorMessage,
    };
    
    return res.status(isPdfError ? 400 : 500).json(errorResponse);
  }
});

/**
 * GET /api/vision/health
 * 
 * Health check endpoint
 */
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    openai_configured: isOpenAIConfigured(),
  });
});

export default router;

