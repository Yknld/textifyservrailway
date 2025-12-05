/**
 * History Routes
 * 
 * Stores and retrieves OCR/analysis history from Supabase
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin, isSupabaseAvailable } from '../lib/supabase.js';

const router = Router();

export interface HistoryEntry {
  id: string;
  user_id: string;
  file_name: string;
  file_size: number;
  file_type: 'image' | 'pdf' | 'spreadsheet' | 'text' | 'screenshot';
  text: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  cost: number;
  created_at: string;
}

/**
 * GET /api/history
 * 
 * Get user's history (paginated)
 */
router.get('/', requireAuth, async (req, res) => {
  if (!isSupabaseAvailable() || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const { data, error, count } = await supabaseAdmin
      .from('history')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[History] Error fetching:', error);
      return res.status(500).json({ error: 'Failed to fetch history' });
    }

    return res.json({
      entries: data || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (e) {
    console.error('[History] Error:', e);
    return res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * POST /api/history
 * 
 * Save a new history entry
 */
router.post('/', requireAuth, async (req, res) => {
  if (!isSupabaseAvailable() || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { fileName, fileSize, fileType, text, tokens, cost } = req.body;

  if (!fileName || !fileType || !text) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('history')
      .insert({
        user_id: req.user!.id,
        file_name: fileName,
        file_size: fileSize || 0,
        file_type: fileType,
        text,
        tokens_input: tokens?.input || 0,
        tokens_output: tokens?.output || 0,
        tokens_total: tokens?.total || 0,
        cost: cost || 0,
      })
      .select()
      .single();

    if (error) {
      console.error('[History] Error saving:', error);
      return res.status(500).json({ error: 'Failed to save history' });
    }

    console.log(`[History] Saved entry for ${req.user!.email}: ${fileName}`);
    return res.json({ entry: data });
  } catch (e) {
    console.error('[History] Error:', e);
    return res.status(500).json({ error: 'Failed to save history' });
  }
});

/**
 * DELETE /api/history/:id
 * 
 * Delete a history entry
 */
router.delete('/:id', requireAuth, async (req, res) => {
  if (!isSupabaseAvailable() || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { id } = req.params;

  try {
    const { error } = await supabaseAdmin
      .from('history')
      .delete()
      .eq('id', id)
      .eq('user_id', req.user!.id); // Ensure user owns the entry

    if (error) {
      console.error('[History] Error deleting:', error);
      return res.status(500).json({ error: 'Failed to delete entry' });
    }

    return res.json({ deleted: true });
  } catch (e) {
    console.error('[History] Error:', e);
    return res.status(500).json({ error: 'Failed to delete entry' });
  }
});

/**
 * DELETE /api/history
 * 
 * Clear all history for user
 */
router.delete('/', requireAuth, async (req, res) => {
  if (!isSupabaseAvailable() || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('history')
      .delete()
      .eq('user_id', req.user!.id);

    if (error) {
      console.error('[History] Error clearing:', error);
      return res.status(500).json({ error: 'Failed to clear history' });
    }

    console.log(`[History] Cleared all history for ${req.user!.email}`);
    return res.json({ cleared: true });
  } catch (e) {
    console.error('[History] Error:', e);
    return res.status(500).json({ error: 'Failed to clear history' });
  }
});

/**
 * GET /api/history/search
 * 
 * Search history by filename
 */
router.get('/search', requireAuth, async (req, res) => {
  if (!isSupabaseAvailable() || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const query = req.query.q as string;
  if (!query) {
    return res.status(400).json({ error: 'Search query required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('history')
      .select('*')
      .eq('user_id', req.user!.id)
      .ilike('file_name', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[History] Search error:', error);
      return res.status(500).json({ error: 'Search failed' });
    }

    return res.json({ entries: data || [] });
  } catch (e) {
    console.error('[History] Error:', e);
    return res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/history/check-duplicate
 * 
 * Check if a file was already processed (by name + size)
 */
router.get('/check-duplicate', requireAuth, async (req, res) => {
  if (!isSupabaseAvailable() || !supabaseAdmin) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const fileName = req.query.fileName as string;
  const fileSize = parseInt(req.query.fileSize as string) || 0;

  if (!fileName) {
    return res.status(400).json({ error: 'fileName required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('history')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('file_name', fileName)
      .eq('file_size', fileSize)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('[History] Duplicate check error:', error);
    }

    return res.json({ 
      isDuplicate: !!data,
      entry: data || null,
    });
  } catch (e) {
    return res.json({ isDuplicate: false, entry: null });
  }
});

export default router;

