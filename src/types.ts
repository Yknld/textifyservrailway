/**
 * Shared types for StudyOCR Backend
 */

/**
 * Token usage information from OpenAI API
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/**
 * Image dimensions after preprocessing
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Result from image preprocessing
 */
export interface PreprocessedImage {
  base64: string;
  width: number;
  height: number;
  processedBuffer?: Buffer; // Raw buffer for download
}

/**
 * Input for GPT-4o Vision analysis
 */
export interface AnalyzeImageInput {
  imageBase64: string;
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Result from GPT-4o Vision analysis
 */
export interface AnalyzeImageResult {
  text: string;
  usage: TokenUsage;
}

/**
 * API response for /api/vision/analyze-image endpoint
 */
export interface VisionAnalyzeResponse {
  text: string;
  usage: TokenUsage;
  image: ImageDimensions;
  cost?: number; // Amount charged to user
  balance?: number; // User's new balance
}

/**
 * API error response
 */
export interface ErrorResponse {
  error: string;
  details?: string;
}

/**
 * Result for a single PDF page
 */
export interface PdfPageResult {
  page: number;
  text: string;
  usage: TokenUsage;
}

/**
 * API response for /api/vision/analyze-pdf endpoint
 */
export interface PdfAnalyzeResponse {
  pages: PdfPageResult[];
  totals: TokenUsage;
  cost?: number; // Amount charged to user
  balance?: number; // User's new balance
}

/**
 * User profile from Supabase
 */
export interface UserProfile {
  id: string;
  email: string;
  balance: number;
  created_at: string;
  updated_at: string;
}

/**
 * Auth session info
 */
export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

/**
 * Login/Signup response
 */
export interface AuthResponse {
  user: {
    id: string;
    email: string;
  };
  session?: AuthSession;
  profile: UserProfile;
}

