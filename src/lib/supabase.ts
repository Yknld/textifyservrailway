/**
 * Supabase Client
 * 
 * Handles authentication and database operations.
 * 
 * Environment Variables:
 *   - SUPABASE_URL: Your Supabase project URL
 *   - SUPABASE_ANON_KEY: Public anon key (for client-side auth)
 *   - SUPABASE_SERVICE_KEY: Service role key (for server-side operations)
 */

import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

// Types for our database
export interface UserProfile {
  id: string;
  email: string;
  balance: number; // In dollars
  created_at: string;
  updated_at: string;
}

export interface UsageLog {
  id: string;
  user_id: string;
  endpoint: string;
  file_name?: string;
  file_type?: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  cost_api: number; // Actual API cost
  cost_charged: number; // What we charge (2x)
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: 'credit' | 'debit' | 'topup' | 'signup_bonus';
  amount: number;
  stripe_payment_id?: string;
  description: string;
  created_at: string;
}

// Initialize Supabase clients
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';

const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY - auth disabled');
}

// Public client (respects RLS) - only create if configured
export const supabase = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Service client (bypasses RLS, for server operations)
export const supabaseAdmin = isSupabaseConfigured
  ? (supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : supabase)
  : null;

// Check if Supabase is available
export function isSupabaseAvailable(): boolean {
  return isSupabaseConfigured && supabaseAdmin !== null;
}

// ============ User Operations ============

/**
 * Get user profile by ID
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  if (!supabaseAdmin) {
    console.warn('[Supabase] Not configured - cannot get user profile');
    return null;
  }
  
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error) {
    console.error('[Supabase] Error getting user profile:', error);
    return null;
  }
  
  return data;
}

/**
 * Create user profile with signup bonus
 */
export async function createUserProfile(userId: string, email: string): Promise<UserProfile | null> {
  if (!supabaseAdmin) {
    console.warn('[Supabase] Not configured - cannot create user profile');
    return null;
  }
  
  const SIGNUP_BONUS = 0.24; // $0.24 free credit
  
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .insert({
      id: userId,
      email,
      balance: SIGNUP_BONUS,
    })
    .select()
    .single();
  
  if (error) {
    console.error('[Supabase] Error creating user profile:', error);
    return null;
  }
  
  // Log the signup bonus
  await logTransaction(userId, 'signup_bonus', SIGNUP_BONUS, 'Welcome bonus - $0.24 free credit');
  
  console.log(`[Supabase] Created profile for ${email} with $${SIGNUP_BONUS} bonus`);
  return data;
}

/**
 * Get or create user profile
 */
export async function getOrCreateUserProfile(userId: string, email: string): Promise<UserProfile | null> {
  let profile = await getUserProfile(userId);
  
  if (!profile) {
    profile = await createUserProfile(userId, email);
  }
  
  return profile;
}

/**
 * Update user balance
 */
export async function updateUserBalance(userId: string, newBalance: number): Promise<boolean> {
  if (!supabaseAdmin) {
    console.warn('[Supabase] Not configured - cannot update balance');
    return false;
  }
  
  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('id', userId);
  
  if (error) {
    console.error('[Supabase] Error updating balance:', error);
    return false;
  }
  
  return true;
}

/**
 * Deduct from user balance
 */
export async function deductBalance(userId: string, amount: number): Promise<{ success: boolean; newBalance: number }> {
  const profile = await getUserProfile(userId);
  
  if (!profile) {
    return { success: false, newBalance: 0 };
  }
  
  const newBalance = Math.max(0, profile.balance - amount);
  const success = await updateUserBalance(userId, newBalance);
  
  return { success, newBalance };
}

/**
 * Add to user balance (for top-ups)
 */
export async function addBalance(userId: string, amount: number): Promise<{ success: boolean; newBalance: number }> {
  const profile = await getUserProfile(userId);
  
  if (!profile) {
    return { success: false, newBalance: 0 };
  }
  
  const newBalance = profile.balance + amount;
  const success = await updateUserBalance(userId, newBalance);
  
  return { success, newBalance };
}

// ============ Usage Logging ============

/**
 * Log API usage
 */
export async function logUsage(
  userId: string,
  endpoint: string,
  tokensInput: number,
  tokensOutput: number,
  costApi: number,
  fileName?: string,
  fileType?: string
): Promise<void> {
  if (!supabaseAdmin) {
    console.log('[Supabase] Not configured - skipping usage log');
    return;
  }
  
  const MARKUP = 2.0; // 2x markup
  const costCharged = costApi * MARKUP;
  
  const { error } = await supabaseAdmin
    .from('usage_logs')
    .insert({
      user_id: userId,
      endpoint,
      file_name: fileName,
      file_type: fileType,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      tokens_total: tokensInput + tokensOutput,
      cost_api: costApi,
      cost_charged: costCharged,
    });
  
  if (error) {
    console.error('[Supabase] Error logging usage:', error);
  }
}

/**
 * Get user's usage history
 */
export async function getUserUsage(userId: string, limit: number = 50): Promise<UsageLog[]> {
  if (!supabaseAdmin) {
    return [];
  }
  
  const { data, error } = await supabaseAdmin
    .from('usage_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('[Supabase] Error getting usage:', error);
    return [];
  }
  
  return data || [];
}

// ============ Transaction Logging ============

/**
 * Log a transaction
 */
export async function logTransaction(
  userId: string,
  type: Transaction['type'],
  amount: number,
  description: string,
  stripePaymentId?: string
): Promise<void> {
  if (!supabaseAdmin) {
    console.log('[Supabase] Not configured - skipping transaction log');
    return;
  }
  
  const { error } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id: userId,
      type,
      amount,
      description,
      stripe_payment_id: stripePaymentId,
    });
  
  if (error) {
    console.error('[Supabase] Error logging transaction:', error);
  }
}

/**
 * Get user's transaction history
 */
export async function getUserTransactions(userId: string, limit: number = 50): Promise<Transaction[]> {
  if (!supabaseAdmin) {
    return [];
  }
  
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('[Supabase] Error getting transactions:', error);
    return [];
  }
  
  return data || [];
}

// ============ Auth Helpers ============

/**
 * Verify JWT token and get user
 */
export async function verifyToken(token: string): Promise<User | null> {
  if (!supabase) {
    return null;
  }
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return null;
  }
  
  return user;
}

