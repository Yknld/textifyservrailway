/**
 * User API Routes
 * 
 * Handles user info and balance tracking.
 * Note: This is a simple in-memory implementation for development.
 * In production, this would connect to a database.
 */

import { Router } from 'express';

// Simple in-memory balance (resets on server restart)
// In production, this would be stored in a database
let userBalance = 10.00; // Start with $10 balance

const router = Router();

/**
 * GET /api/user/me
 * 
 * Get current user info including balance
 */
router.get('/me', (_req, res) => {
  res.json({
    balance: userBalance,
    email: 'demo@studyocr.com', // Placeholder
  });
});

/**
 * POST /api/user/deduct
 * 
 * Deduct amount from balance (called after processing)
 * Body: { amount: number }
 */
router.post('/deduct', (req, res) => {
  const { amount } = req.body;
  
  if (typeof amount !== 'number' || amount < 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  
  userBalance = Math.max(0, userBalance - amount);
  
  return res.json({
    balance: userBalance,
    deducted: amount,
  });
});

/**
 * POST /api/user/add-balance
 * 
 * Add funds to balance (for testing)
 * Body: { amount: number }
 */
router.post('/add-balance', (req, res) => {
  const { amount } = req.body;
  
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  
  userBalance += amount;
  
  return res.json({
    balance: userBalance,
    added: amount,
  });
});

/**
 * Get current balance (internal use)
 */
export function getCurrentBalance(): number {
  return userBalance;
}

/**
 * Deduct from balance (internal use)
 */
export function deductBalance(amount: number): number {
  userBalance = Math.max(0, userBalance - amount);
  return userBalance;
}

export default router;

