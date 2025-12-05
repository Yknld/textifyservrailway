/**
 * Excel/Spreadsheet Analysis Routes
 * 
 * Provides endpoints for analyzing Excel and CSV files:
 * - Extracts structure, stats, and metadata
 * - Generates human-readable summaries via GPT
 * - Does NOT send full data to GPT, only metadata and samples
 * 
 * Requires authentication and tracks usage/billing.
 */

import { Router } from 'express';
import multer from 'multer';
import { analyzeExcelStructure } from '../lib/excelAnalyzer.js';
import { requireAuth } from '../middleware/auth.js';
import { calculateCost } from '../lib/billing.js';
import { deductBalance, logUsage } from '../lib/supabase.js';

const router = Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (_req, file, cb) => {
    // Accept Excel and CSV files
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'application/csv', // .csv (alternate)
      'text/plain', // .csv sometimes sent as text/plain
    ];
    
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    
    if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only Excel (.xlsx, .xls) and CSV files are accepted.`));
    }
  },
});

/**
 * POST /api/excel/analyze
 * 
 * Analyze an Excel or CSV file and return:
 * - Structured workbook metadata (sheets, columns, types, stats, samples)
 * - Chart analysis if charts are present
 * 
 * Requires authentication and deducts from user balance (if charts analyzed).
 * 
 * Request: multipart/form-data with "file" field
 * Response: {
 *   workbook: ExcelWorkbookSummary,
 *   usage: { input_tokens, output_tokens, total_tokens },
 *   cost: number,
 *   balance: number
 * }
 */
router.post('/analyze', requireAuth, upload.single('file'), async (req, res) => {
  console.log(`[Excel] Received analyze request from user ${req.user!.email}`);
  
  try {
    // Validate file presence
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded. Please provide an Excel or CSV file.' 
      });
    }
    
    const { buffer, originalname } = req.file;
    
    console.log(`[Excel] Processing file: ${originalname} (${(buffer.length / 1024).toFixed(1)}KB)`);
    
    // Analyze workbook structure
    let workbook;
    try {
      workbook = await analyzeExcelStructure({
        buffer,
        filename: originalname,
      });
    } catch (parseError) {
      console.error('[Excel] Parse error:', parseError);
      return res.status(400).json({
        error: parseError instanceof Error 
          ? parseError.message 
          : 'Failed to parse Excel/CSV file',
      });
    }
    
    console.log(`[Excel] Workbook parsed: ${workbook.sheets.length} sheet(s)`);
    
    // Calculate total usage (chart analysis if any)
    const usage = workbook.chartAnalysisUsage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    
    // Calculate cost if there was any GPT usage
    let chargedCost = 0;
    let newBalance = req.user!.profile.balance;
    
    if (usage.total_tokens > 0) {
      const cost = calculateCost(usage);
      chargedCost = cost.chargedCost;
      
      // Deduct from user balance
      const result = await deductBalance(req.user!.id, chargedCost);
      newBalance = result.newBalance;
      
      // Log usage
      await logUsage(
        req.user!.id,
        '/api/excel/analyze',
        usage.input_tokens,
        usage.output_tokens,
        cost.apiCost,
        originalname,
        'spreadsheet'
      );
    }
    
    // Return structured data
    const response = {
      workbook: {
        workbook: workbook.workbook,
        sheets: workbook.sheets,
        codebook: workbook.codebook,
        charts: workbook.charts,
      },
      usage,
      cost: chargedCost,
      balance: newBalance,
    };
    
    if (workbook.charts && workbook.charts.length > 0) {
      console.log(`[Excel] Found and analyzed ${workbook.charts.length} chart(s), cost: $${chargedCost.toFixed(4)}`);
    }
    
    console.log(`[Excel] Analysis complete for "${originalname}"`);
    
    return res.json(response);
    
  } catch (error) {
    console.error('[Excel] Unexpected error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * GET /api/excel/health
 * 
 * Health check for Excel analysis endpoint
 */
router.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'excel-analyzer',
    supportedFormats: ['.xlsx', '.xls', '.csv'],
  });
});

export default router;

