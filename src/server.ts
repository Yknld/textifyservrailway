/**
 * StudyOCR Backend Server
 * 
 * Express server that provides OCR via GPT-4o Vision API.
 * 
 * Environment Variables:
 *   - OPENAI_API_KEY: Your OpenAI API key (required)
 *   - PORT: Server port (default: 4000)
 * 
 * Usage:
 *   1. Copy .env.example to .env and add your OpenAI API key
 *   2. Run: npm run dev
 *   3. Test: curl -X POST http://localhost:4000/api/vision/analyze-image -F "file=@image.png"
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import visionRouter from './routes/vision.js';
import userRouter from './routes/user.js';
import excelRouter from './routes/excel.js';
import authRouter from './routes/auth.js';
import paymentsRouter from './routes/payments.js';
import historyRouter from './routes/history.js';

// Configuration
const PORT = process.env.PORT || 4000;

// Create Express app
const app = express();

// CORS configuration - allow Chrome extension origins
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      return callback(null, true);
    }
    
    // Allow Chrome extension origins
    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    
    // Allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    // Reject other origins
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Parse JSON bodies
app.use(express.json({ limit: '50mb' }));

// Mount routes
app.use('/api/auth', authRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/vision', visionRouter);
app.use('/api/user', userRouter);
app.use('/api/excel', excelRouter);
app.use('/api/history', historyRouter);

// Payment success page
app.get('/payment/success', async (req, res) => {
  const sessionId = req.query.session_id as string;
  
  // Process the payment if session_id provided
  if (sessionId) {
    const { processCompletedCheckout } = await import('./lib/stripe.js');
    await processCompletedCheckout(sessionId);
  }
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Successful</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #1a1a1a;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
        }
        .container {
          text-align: center;
          padding: 40px;
        }
        .icon {
          font-size: 64px;
          margin-bottom: 20px;
        }
        h1 {
          font-size: 28px;
          margin-bottom: 12px;
        }
        p {
          color: #888;
          font-size: 16px;
          margin-bottom: 24px;
        }
        .close-btn {
          background: #fff;
          color: #1a1a1a;
          border: none;
          padding: 12px 32px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
        }
        .close-btn:hover {
          background: #e0e0e0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">✅</div>
        <h1>Payment Successful!</h1>
        <p>Your credits have been added to your account.<br>You can close this tab and reopen the extension.</p>
        <button class="close-btn" onclick="closeTab()">Close Tab</button>
        <p class="hint" id="hint" style="display:none; margin-top: 16px; font-size: 14px;">
          Press <kbd style="background:#333; padding:2px 8px; border-radius:4px;">Ctrl+W</kbd> (or <kbd style="background:#333; padding:2px 8px; border-radius:4px;">Cmd+W</kbd> on Mac) to close this tab
        </p>
      </div>
      <script>
        function closeTab() {
          window.close();
          // If window.close() didn't work (browser blocked it), show hint
          setTimeout(() => {
            document.getElementById('hint').style.display = 'block';
          }, 100);
        }
      </script>
    </body>
    </html>
  `);
});

// Payment cancelled page
app.get('/payment/cancel', (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Cancelled</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #1a1a1a;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
        }
        .container {
          text-align: center;
          padding: 40px;
        }
        .icon {
          font-size: 64px;
          margin-bottom: 20px;
        }
        h1 {
          font-size: 28px;
          margin-bottom: 12px;
        }
        p {
          color: #888;
          font-size: 16px;
          margin-bottom: 24px;
        }
        .close-btn {
          background: #fff;
          color: #1a1a1a;
          border: none;
          padding: 12px 32px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">❌</div>
        <h1>Payment Cancelled</h1>
        <p>No charges were made.<br>You can close this tab and try again in the extension.</p>
        <button class="close-btn" onclick="closeTab()">Close Tab</button>
        <p class="hint" id="hint" style="display:none; margin-top: 16px; font-size: 14px;">
          Press <kbd style="background:#333; padding:2px 8px; border-radius:4px;">Ctrl+W</kbd> (or <kbd style="background:#333; padding:2px 8px; border-radius:4px;">Cmd+W</kbd> on Mac) to close this tab
        </p>
      </div>
      <script>
        function closeTab() {
          window.close();
          setTimeout(() => {
            document.getElementById('hint').style.display = 'block';
          }, 100);
        }
      </script>
    </body>
    </html>
  `);
});

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    name: 'StudyOCR Backend',
    version: '2.0.0',
    endpoints: {
      // Auth
      'POST /api/auth/signup': 'Create new account',
      'POST /api/auth/login': 'Login with email/password',
      'GET /api/auth/me': 'Get current user info (requires auth)',
      // Payments
      'GET /api/payments/plans': 'Get available top-up plans',
      'POST /api/payments/checkout': 'Create Stripe checkout session',
      'GET /api/payments/transactions': 'Get transaction history',
      // Vision
      'POST /api/vision/analyze-image': 'Upload image for OCR (requires auth)',
      'POST /api/vision/analyze-pdf': 'Upload PDF for OCR (requires auth)',
      'GET /api/vision/health': 'Health check',
      // Excel
      'POST /api/excel/analyze': 'Upload Excel/CSV for analysis (requires auth)',
      'GET /api/excel/health': 'Excel analyzer health check',
      // User
      'GET /api/user/me': 'Get user info and balance',
    },
  });
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] Error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   StudyOCR Backend Server v2.0        ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║  🚀 Running on http://localhost:${PORT}    ║`);
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  
  // Config status
  console.log('Configuration:');
  console.log(`  ${process.env.OPENAI_API_KEY ? '✓' : '✗'} OpenAI API key`);
  console.log(`  ${process.env.SUPABASE_URL ? '✓' : '✗'} Supabase URL`);
  console.log(`  ${process.env.SUPABASE_ANON_KEY ? '✓' : '✗'} Supabase Anon Key`);
  console.log(`  ${process.env.SUPABASE_SERVICE_KEY ? '✓' : '○'} Supabase Service Key (optional)`);
  console.log(`  ${process.env.STRIPE_SECRET_KEY ? '✓' : '✗'} Stripe Secret Key`);
  console.log(`  ${process.env.STRIPE_WEBHOOK_SECRET ? '✓' : '○'} Stripe Webhook Secret (optional)`);
  console.log('');
  
  console.log('Endpoints:');
  console.log('  Auth:');
  console.log('    POST /api/auth/signup        - Create account');
  console.log('    POST /api/auth/login         - Login');
  console.log('    GET  /api/auth/me            - Get current user');
  console.log('  Payments:');
  console.log('    GET  /api/payments/plans     - Top-up plans');
  console.log('    POST /api/payments/checkout  - Create Stripe session');
  console.log('  Vision:');
  console.log('    POST /api/vision/analyze-image - OCR image');
  console.log('    POST /api/vision/analyze-pdf   - OCR PDF');
  console.log('  Excel:');
  console.log('    POST /api/excel/analyze        - Analyze spreadsheet');
  console.log('');
});

