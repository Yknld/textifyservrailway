/**
 * Payment Routes
 * 
 * Handles Stripe payments for balance top-ups
 */

import { Router, raw } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { 
  createCheckoutSession, 
  processCompletedCheckout,
  handleWebhook,
  TOPUP_AMOUNTS 
} from '../lib/stripe.js';
import { getUserTransactions, getUserUsage } from '../lib/supabase.js';

const router = Router();

/**
 * GET /api/payments/plans
 * 
 * Get available top-up amounts
 */
router.get('/plans', (_req, res) => {
  return res.json({
    plans: TOPUP_AMOUNTS.map(p => ({
      amount: p.amount,
      label: p.label,
      bonus: p.bonus,
      total: p.amount + p.bonus,
    })),
  });
});

/**
 * POST /api/payments/checkout
 * 
 * Create a Stripe checkout session
 */
router.post('/checkout', requireAuth, async (req, res) => {
  const { amount } = req.body;
  
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount required' });
  }
  
  // Validate amount is one of our tiers
  const validAmounts = TOPUP_AMOUNTS.map(t => t.amount);
  if (!validAmounts.includes(amount)) {
    return res.status(400).json({ 
      error: 'Invalid amount',
      validAmounts,
    });
  }
  
  const result = await createCheckoutSession(
    req.user!.id,
    req.user!.email,
    amount
  );
  
  if (!result) {
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
  
  return res.json({
    url: result.url,
    sessionId: result.sessionId,
  });
});

/**
 * GET /api/payments/success
 * 
 * Verify checkout session completion
 */
router.get('/success', requireAuth, async (req, res) => {
  const { session_id } = req.query;
  
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'Session ID required' });
  }
  
  const success = await processCompletedCheckout(session_id);
  
  if (!success) {
    return res.status(400).json({ error: 'Payment not completed or already processed' });
  }
  
  return res.json({ 
    success: true,
    message: 'Payment processed successfully',
  });
});

/**
 * GET /api/payments/transactions
 * 
 * Get user's transaction history
 */
router.get('/transactions', requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const transactions = await getUserTransactions(req.user!.id, limit);
  
  return res.json({ transactions });
});

/**
 * GET /api/payments/usage
 * 
 * Get user's usage history
 */
router.get('/usage', requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const usage = await getUserUsage(req.user!.id, limit);
  
  return res.json({ usage });
});

/**
 * POST /api/payments/webhook
 * 
 * Stripe webhook handler
 * NOTE: This route needs raw body, not JSON parsed
 */
router.post('/webhook', raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'] as string;
  
  if (!signature) {
    return res.status(400).json({ error: 'Missing signature' });
  }
  
  const result = await handleWebhook(req.body, signature);
  
  if (!result.success) {
    return res.status(400).json({ error: 'Webhook processing failed' });
  }
  
  return res.json({ received: true, event: result.event });
});

export default router;

