-- ============================================
-- StudyOCR Supabase Database Schema
-- ============================================
-- Run this in your Supabase SQL editor to set up the tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USER PROFILES TABLE
-- ============================================
-- Extends Supabase auth.users with app-specific data
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  balance DECIMAL(10, 6) NOT NULL DEFAULT 1.00, -- $1 signup bonus
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- ============================================
-- USAGE LOGS TABLE
-- ============================================
-- Tracks every API call for billing and analytics
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT, -- 'image', 'pdf', 'spreadsheet'
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  cost_api DECIMAL(10, 6) NOT NULL DEFAULT 0, -- What we paid OpenAI
  cost_charged DECIMAL(10, 6) NOT NULL DEFAULT 0, -- What we charged (2x)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_date ON usage_logs(user_id, created_at);

-- Enable Row Level Security
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- Users can only view their own usage
CREATE POLICY "Users can view own usage" ON usage_logs
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- TRANSACTIONS TABLE
-- ============================================
-- Tracks all balance changes (top-ups, refunds, etc.)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit', 'topup', 'signup_bonus', 'refund')),
  amount DECIMAL(10, 6) NOT NULL, -- Positive for credits, can be negative for debits
  stripe_payment_id TEXT, -- Stripe checkout session ID
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_stripe ON transactions(stripe_payment_id);

-- Enable Row Level Security
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Users can only view their own transactions
CREATE POLICY "Users can view own transactions" ON transactions
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- DEVICE FINGERPRINTS TABLE
-- ============================================
-- Tracks devices that have claimed the signup bonus
-- Users can create unlimited accounts but only get bonus once per device
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  claimed_bonus BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast device lookups
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_device_id ON device_fingerprints(device_id);

-- Grant service role permissions
GRANT INSERT, SELECT ON device_fingerprints TO service_role;

-- ============================================
-- FUNCTION: Create profile on signup
-- ============================================
-- Automatically creates a user_profile when someone signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, balance)
  VALUES (NEW.id, NEW.email, 1.00)
  ON CONFLICT (id) DO NOTHING;
  
  -- Log signup bonus
  INSERT INTO public.transactions (user_id, type, amount, description)
  VALUES (NEW.id, 'signup_bonus', 1.00, 'Welcome bonus - $1 free credit');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function on new user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- FUNCTION: Update balance timestamp
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for user_profiles
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================
-- GRANT SERVICE ROLE PERMISSIONS
-- ============================================
-- These are needed for the backend to insert/update using service key

-- Allow service role to insert usage logs
GRANT INSERT ON usage_logs TO service_role;
GRANT INSERT ON transactions TO service_role;

-- Allow service role to update profiles (for balance changes)
GRANT UPDATE ON user_profiles TO service_role;
GRANT SELECT ON user_profiles TO service_role;

-- ============================================
-- SAMPLE QUERIES
-- ============================================

-- Get user's total spend
-- SELECT SUM(cost_charged) FROM usage_logs WHERE user_id = 'user-uuid';

-- Get user's usage by file type
-- SELECT file_type, COUNT(*), SUM(cost_charged) 
-- FROM usage_logs WHERE user_id = 'user-uuid' 
-- GROUP BY file_type;

-- Get daily revenue
-- SELECT DATE(created_at), SUM(amount) 
-- FROM transactions WHERE type = 'topup' 
-- GROUP BY DATE(created_at);

