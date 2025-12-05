/**
 * Billing & Cost Calculation
 * 
 * GPT-4o pricing (as of Dec 2024):
 *   - Input: $2.50 / 1M tokens
 *   - Output: $10.00 / 1M tokens
 * 
 * We charge 2x the API cost.
 */

// GPT-4o pricing per token
const GPT4O_INPUT_COST_PER_TOKEN = 2.50 / 1_000_000;
const GPT4O_OUTPUT_COST_PER_TOKEN = 10.00 / 1_000_000;

// Our markup multiplier
export const MARKUP_MULTIPLIER = 2.0;

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface CostBreakdown {
  apiCost: number; // What we pay OpenAI
  chargedCost: number; // What we charge user (2x)
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Calculate costs from token usage
 */
export function calculateCost(usage: TokenUsage): CostBreakdown {
  const inputCost = usage.input_tokens * GPT4O_INPUT_COST_PER_TOKEN;
  const outputCost = usage.output_tokens * GPT4O_OUTPUT_COST_PER_TOKEN;
  const apiCost = inputCost + outputCost;
  const chargedCost = apiCost * MARKUP_MULTIPLIER;
  
  return {
    apiCost: Math.round(apiCost * 1_000_000) / 1_000_000, // Round to 6 decimal places
    chargedCost: Math.round(chargedCost * 1_000_000) / 1_000_000,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  };
}

/**
 * Estimate cost before processing (based on file size)
 * Very rough estimate - actual cost depends on content
 */
export function estimateCost(fileSizeBytes: number, fileType: 'image' | 'pdf' | 'excel'): {
  estimatedMinCost: number;
  estimatedMaxCost: number;
} {
  // Average tokens per file type (rough estimates)
  const estimates: Record<string, { minTokens: number; maxTokens: number }> = {
    image: { minTokens: 500, maxTokens: 3000 },
    pdf: { minTokens: 1000 * Math.ceil(fileSizeBytes / 500000), maxTokens: 5000 * Math.ceil(fileSizeBytes / 500000) },
    excel: { minTokens: 200, maxTokens: 1000 },
  };
  
  const { minTokens, maxTokens } = estimates[fileType] || estimates.image;
  
  // Assume 80% input, 20% output tokens
  const minCost = calculateCost({
    input_tokens: Math.round(minTokens * 0.8),
    output_tokens: Math.round(minTokens * 0.2),
    total_tokens: minTokens,
  });
  
  const maxCost = calculateCost({
    input_tokens: Math.round(maxTokens * 0.8),
    output_tokens: Math.round(maxTokens * 0.2),
    total_tokens: maxTokens,
  });
  
  return {
    estimatedMinCost: minCost.chargedCost,
    estimatedMaxCost: maxCost.chargedCost,
  };
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 100).toFixed(2)}¢`;
  }
  return `$${cost.toFixed(4)}`;
}

/**
 * Check if user has sufficient balance
 */
export function hasSufficientBalance(balance: number, estimatedCost: number): boolean {
  // Add a small buffer for estimation errors
  return balance >= estimatedCost * 0.8;
}

