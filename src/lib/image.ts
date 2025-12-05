/**
 * Image preprocessing utilities using Sharp
 * 
 * Handles image resizing and conversion for optimal GPT-4o Vision processing.
 */

import sharp from 'sharp';
import type { PreprocessedImage } from '../types.js';

// Maximum dimension for the longest side (reduced for cost savings)
const MAX_DIMENSION = 1500;

// Output format configuration - aggressive compression for cost
const OUTPUT_FORMAT = 'webp' as const;
const OUTPUT_QUALITY = 50;

/**
 * Preprocess an image buffer for GPT-4o Vision API
 * 
 * - Resizes so longest side is at most 1500px (preserves aspect ratio)
 * - Converts to WebP format for efficient transmission
 * - Returns base64 data URL and final dimensions
 * 
 * @param fileBuffer - Raw image file buffer
 * @returns Preprocessed image with base64 data URL and dimensions
 */
export async function preprocessImageToBase64(
  fileBuffer: Buffer
): Promise<PreprocessedImage> {
  // Load image and get metadata
  const image = sharp(fileBuffer);
  const metadata = await image.metadata();
  
  const originalWidth = metadata.width || 0;
  const originalHeight = metadata.height || 0;
  
  console.log(`[Image] Original size: ${originalWidth}x${originalHeight}`);
  
  // Calculate new dimensions (resize only if needed)
  let targetWidth = originalWidth;
  let targetHeight = originalHeight;
  
  if (originalWidth > MAX_DIMENSION || originalHeight > MAX_DIMENSION) {
    if (originalWidth > originalHeight) {
      // Landscape: constrain width
      targetWidth = MAX_DIMENSION;
      targetHeight = Math.round((originalHeight / originalWidth) * MAX_DIMENSION);
    } else {
      // Portrait or square: constrain height
      targetHeight = MAX_DIMENSION;
      targetWidth = Math.round((originalWidth / originalHeight) * MAX_DIMENSION);
    }
    
    console.log(`[Image] Resizing to: ${targetWidth}x${targetHeight}`);
  }
  
  // Process the image
  const processedBuffer = await image
    .resize(targetWidth, targetHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: OUTPUT_QUALITY })
    .toBuffer();
  
  // Convert to base64 data URL
  const base64 = `data:image/${OUTPUT_FORMAT};base64,${processedBuffer.toString('base64')}`;
  
  console.log(`[Image] Final: ${targetWidth}x${targetHeight}, ${Math.round(processedBuffer.length / 1024)}KB`);
  
  return {
    base64,
    width: targetWidth,
    height: targetHeight,
    processedBuffer, // Include the buffer for download
  };
}

/**
 * Get image metadata without processing
 */
export async function getImageMetadata(fileBuffer: Buffer) {
  const metadata = await sharp(fileBuffer).metadata();
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format,
  };
}

