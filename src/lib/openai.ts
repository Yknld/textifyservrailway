/**
 * OpenAI GPT-4o Vision client and helper functions
 * 
 * Handles communication with OpenAI's Vision API for OCR tasks.
 */

import OpenAI from 'openai';
import type { AnalyzeImageInput, AnalyzeImageResult } from '../types.js';

// Initialize OpenAI client (uses OPENAI_API_KEY from environment)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model to use for vision tasks
const VISION_MODEL = 'gpt-4o';

/**
 * Analyze an image using GPT-4o Vision
 * 
 * Sends the image to OpenAI's Vision API with the provided prompts
 * and returns the extracted text along with token usage.
 * 
 * @param input - Image base64 and prompts
 * @returns Extracted text and token usage statistics
 */
export async function analyzeImageWithGPT(
  input: AnalyzeImageInput
): Promise<AnalyzeImageResult> {
  const { imageBase64, systemPrompt, userPrompt } = input;
  
  console.log(`[OpenAI] Sending image to ${VISION_MODEL}...`);
  
  const response = await openai.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userPrompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: imageBase64,
              detail: 'high', // Use high detail for better OCR accuracy
            },
          },
        ],
      },
    ],
    max_tokens: 4096,
  });
  
  // Extract the response text
  const text = response.choices[0]?.message?.content || '';
  
  // Extract usage information
  const usage = {
    input_tokens: response.usage?.prompt_tokens || 0,
    output_tokens: response.usage?.completion_tokens || 0,
    total_tokens: response.usage?.total_tokens || 0,
  };
  
  console.log(`[OpenAI] Response received. Tokens: ${usage.total_tokens} (in: ${usage.input_tokens}, out: ${usage.output_tokens})`);
  
  return { text, usage };
}

/**
 * Check if OpenAI API key is configured
 */
export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

