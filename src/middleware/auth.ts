/**
 * Authentication Middleware
 * 
 * Verifies Supabase JWT tokens and attaches user info to requests.
 */

import { Request, Response, NextFunction } from 'express';
import { verifyToken, getOrCreateUserProfile, getUserProfile, UserProfile, isSupabaseAvailable } from '../lib/supabase.js';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        profile: UserProfile;
      };
    }
  }
}

/**
 * Require authentication - reject if no valid token
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // If Supabase is not configured, skip auth (dev mode)
  if (!isSupabaseAvailable()) {
    // Create a mock user for development
    req.user = {
      id: 'dev-user',
      email: 'dev@localhost',
      profile: {
        id: 'dev-user',
        email: 'dev@localhost',
        balance: 999.99,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };
    return next();
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Authentication required',
      message: 'Please provide a valid Bearer token'
    });
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer '
  
  try {
    const user = await verifyToken(token);
    
    if (!user || !user.email) {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Token is invalid or expired'
      });
    }
    
    // Get or create user profile
    const profile = await getOrCreateUserProfile(user.id, user.email);
    
    if (!profile) {
      return res.status(500).json({ 
        error: 'Profile error',
        message: 'Could not load user profile'
      });
    }
    
    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      profile,
    };
    
    next();
  } catch (error) {
    console.error('[Auth] Token verification failed:', error);
    return res.status(401).json({ 
      error: 'Authentication failed',
      message: 'Could not verify token'
    });
  }
}

/**
 * Optional authentication - continue even if no token
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(); // Continue without auth
  }
  
  const token = authHeader.substring(7);
  
  try {
    const user = await verifyToken(token);
    
    if (user && user.email) {
      const profile = await getOrCreateUserProfile(user.id, user.email);
      
      if (profile) {
        req.user = {
          id: user.id,
          email: user.email,
          profile,
        };
      }
    }
  } catch (error) {
    // Ignore errors for optional auth
    console.log('[Auth] Optional auth failed, continuing without auth');
  }
  
  next();
}

/**
 * Check if user has sufficient balance
 */
export async function requireBalance(minBalance: number = 0) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (req.user.profile.balance < minBalance) {
      return res.status(402).json({ 
        error: 'Insufficient balance',
        message: `You need at least $${minBalance.toFixed(2)} to perform this action`,
        balance: req.user.profile.balance,
      });
    }
    
    next();
  };
}

/**
 * Refresh user profile (for after balance changes)
 */
export async function refreshUserProfile(req: Request): Promise<UserProfile | null> {
  if (!req.user) return null;
  
  const profile = await getUserProfile(req.user.id);
  if (profile && req.user) {
    req.user.profile = profile;
  }
  
  return profile;
}

