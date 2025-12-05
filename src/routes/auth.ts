/**
 * Authentication Routes
 * 
 * Handles user authentication via Supabase
 */

import { Router } from 'express';
import { supabase, getOrCreateUserProfile, getUserProfile, isSupabaseAvailable } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Middleware to check if Supabase is configured
function requireSupabase(req: any, res: any, next: any) {
  if (!isSupabaseAvailable() || !supabase) {
    return res.status(503).json({ 
      error: 'Auth not configured',
      message: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
    });
  }
  next();
}

/**
 * POST /api/auth/signup
 * 
 * Create a new account with email/password
 */
router.post('/signup', requireSupabase, async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  try {
    const { data, error } = await supabase!.auth.signUp({
      email,
      password,
    });
    
    if (error) {
      console.error('[Auth] Signup error:', error);
      return res.status(400).json({ error: error.message });
    }
    
    if (!data.user) {
      return res.status(400).json({ error: 'Failed to create account' });
    }
    
    // Create user profile with $1 bonus
    const profile = await getOrCreateUserProfile(data.user.id, email);
    
    console.log(`[Auth] New signup: ${email}`);
    
    return res.json({
      message: 'Account created successfully',
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      session: data.session,
      profile,
    });
  } catch (error) {
    console.error('[Auth] Signup error:', error);
    return res.status(500).json({ error: 'Failed to create account' });
  }
});

/**
 * POST /api/auth/login
 * 
 * Login with email/password
 */
router.post('/login', requireSupabase, async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    const { data, error } = await supabase!.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      console.error('[Auth] Login error:', error);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    if (!data.user || !data.session) {
      return res.status(401).json({ error: 'Login failed' });
    }
    
    // Get or create profile
    const profile = await getOrCreateUserProfile(data.user.id, email);
    
    console.log(`[Auth] Login: ${email}`);
    
    return res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
      profile,
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/logout
 * 
 * Logout current session
 */
router.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader?.startsWith('Bearer ')) {
    // Note: Supabase doesn't have server-side logout, client should discard token
  }
  
  return res.json({ message: 'Logged out successfully' });
});

/**
 * POST /api/auth/refresh
 * 
 * Refresh access token
 */
router.post('/refresh', requireSupabase, async (req, res) => {
  const { refresh_token } = req.body;
  
  if (!refresh_token) {
    return res.status(400).json({ error: 'Refresh token required' });
  }
  
  try {
    const { data, error } = await supabase!.auth.refreshSession({
      refresh_token,
    });
    
    if (error || !data.session) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    return res.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  } catch (error) {
    console.error('[Auth] Refresh error:', error);
    return res.status(500).json({ error: 'Failed to refresh token' });
  }
});

/**
 * GET /api/auth/me
 * 
 * Get current user info (requires auth)
 */
router.get('/me', requireAuth, async (req, res) => {
  return res.json({
    user: {
      id: req.user!.id,
      email: req.user!.email,
    },
    profile: req.user!.profile,
  });
});

/**
 * POST /api/auth/reset-password
 * 
 * Send password reset email
 */
router.post('/reset-password', requireSupabase, async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  try {
    const { error } = await supabase!.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password`,
    });
    
    if (error) {
      console.error('[Auth] Reset password error:', error);
      // Don't reveal if email exists
    }
    
    // Always return success to not reveal if email exists
    return res.json({ message: 'If an account exists, a reset email has been sent' });
  } catch (error) {
    console.error('[Auth] Reset password error:', error);
    return res.json({ message: 'If an account exists, a reset email has been sent' });
  }
});

export default router;

