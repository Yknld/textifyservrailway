/**
 * Excel Summary LLM Module
 * 
 * Uses GPT (text-only) to generate human-readable summaries
 * of Excel workbook structure and potential insights.
 */

import OpenAI from 'openai';
import type { ExcelWorkbookSummary } from './excelAnalyzer.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model for text summarization (cheaper than vision)
const TEXT_MODEL = 'gpt-4o-mini';

// ============ Types ============

export interface ExcelLLMOutput {
  rawSummary: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

// ============ Prompts ============

const SYSTEM_PROMPT = `You are a data analyst assistant. You receive a structured description of an Excel workbook containing:
- Sheet names
- Column headers and their data types
- Basic statistics (min, max, average) for numeric columns
- A few sample rows
- Potential chart candidates

Your job is to produce a concise, clear summary that:
1. Describes the overall purpose/contents of the workbook
2. Explains what each sheet contains
3. Highlights important columns and what they represent
4. Describes any trends suggested by the statistics
5. Explains what the chart candidates could visualize

Guidelines:
- Do NOT repeat all sample rows verbatim
- Do NOT list every single number from the stats
- Focus on meaning and insights, not raw data
- Keep the summary readable and useful for someone who hasn't seen the spreadsheet
- If chart candidates exist, explain what they would show
- Be concise but thorough`;

function buildUserPrompt(summary: ExcelWorkbookSummary): string {
  const jsonStr = JSON.stringify(summary, null, 2);
  
  return `Here is the workbook structure as JSON:

\`\`\`json
${jsonStr}
\`\`\`

Please provide a clear, human-readable summary of this workbook. Describe what data it contains, what insights can be drawn from the statistics, and what the suggested charts would show.`;
}

// ============ Main Function ============

/**
 * Generate a human-readable summary of an Excel workbook using GPT
 */
export async function summarizeExcelWithGPT(
  summary: ExcelWorkbookSummary
): Promise<ExcelLLMOutput> {
  console.log(`[ExcelLLM] Generating summary for "${summary.workbook}"`);
  
  const userPrompt = buildUserPrompt(summary);
  
  try {
    const response = await openai.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3, // Lower temperature for more focused output
      max_tokens: 1500,
    });
    
    const rawSummary = response.choices[0]?.message?.content || 'Unable to generate summary.';
    
    const usage = {
      input_tokens: response.usage?.prompt_tokens || 0,
      output_tokens: response.usage?.completion_tokens || 0,
      total_tokens: response.usage?.total_tokens || 0,
    };
    
    console.log(`[ExcelLLM] Summary generated. Tokens: ${usage.total_tokens}`);
    
    return {
      rawSummary,
      usage,
    };
  } catch (error) {
    console.error('[ExcelLLM] Error calling OpenAI:', error);
    throw new Error('Failed to generate workbook summary');
  }
}

