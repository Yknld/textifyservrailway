# StudyOCR Backend

Node.js/TypeScript backend service for StudyOCR that provides OCR via GPT-4o Vision API.

## Features

- 📷 Image upload and preprocessing (resize, optimize)
- 🔍 High-accuracy OCR using GPT-4o Vision
- 📊 Token usage tracking
- 🔒 CORS configured for Chrome extension

## Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

Copy the example environment file and add your OpenAI API key:

```bash
cp .env.example .env
```

Edit `.env` and set your OpenAI API key:

```env
OPENAI_API_KEY=sk-your-actual-api-key-here
PORT=4000
```

Get your API key at: https://platform.openai.com/api-keys

### 3. Run the Server

**Development (with hot reload):**

```bash
npm run dev
```

**Production:**

```bash
npm run build
npm start
```

## API Endpoints

### `POST /api/vision/analyze-image`

Upload an image for OCR processing.

**Request:**
- Content-Type: `multipart/form-data`
- Field: `file` - The image file (PNG, JPEG, WebP, GIF, HEIC)

**Response:**
```json
{
  "text": "Extracted text content...",
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 567,
    "total_tokens": 1801
  },
  "image": {
    "width": 1500,
    "height": 1000
  }
}
```

### `POST /api/vision/analyze-pdf`

Upload a PDF for OCR processing. Each page is converted to an image and processed separately.

**Request:**
- Content-Type: `multipart/form-data`
- Field: `file` - The PDF file

**Response:**
```json
{
  "pages": [
    {
      "page": 1,
      "text": "Text from page 1...",
      "usage": {
        "input_tokens": 1000,
        "output_tokens": 200,
        "total_tokens": 1200
      }
    },
    {
      "page": 2,
      "text": "Text from page 2...",
      "usage": {
        "input_tokens": 800,
        "output_tokens": 150,
        "total_tokens": 950
      }
    }
  ],
  "totals": {
    "input_tokens": 1800,
    "output_tokens": 350,
    "total_tokens": 2150
  }
}
```

**Error Responses:**
- `400` - Invalid PDF file or unable to parse
- `500` - Processing error

### `GET /api/vision/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "openai_configured": true
}
```

## Testing with cURL

```bash
# Health check
curl http://localhost:4000/api/vision/health

# Upload an image for OCR
curl -X POST http://localhost:4000/api/vision/analyze-image \
  -F "file=@path/to/your/image.png"

# Upload image with verbose output
curl -X POST http://localhost:4000/api/vision/analyze-image \
  -F "file=@screenshot.png" \
  -H "Accept: application/json" \
  | jq

# Upload a PDF for OCR (each page processed separately)
curl -X POST http://localhost:4000/api/vision/analyze-pdf \
  -F "file=@document.pdf"

# Upload PDF with verbose output
curl -X POST http://localhost:4000/api/vision/analyze-pdf \
  -F "file=@document.pdf" \
  -H "Accept: application/json" \
  | jq
```

## Testing with Postman

1. Create a new POST request to `http://localhost:4000/api/vision/analyze-image`
2. Go to "Body" tab
3. Select "form-data"
4. Add a key named `file` with type "File"
5. Select your image file
6. Send the request

## Project Structure

```
backend/
├── src/
│   ├── server.ts          # Express server entry point
│   ├── types.ts           # Shared TypeScript types
│   ├── routes/
│   │   └── vision.ts      # Vision API routes
│   └── lib/
│       ├── openai.ts      # OpenAI client & helpers
│       └── image.ts       # Image preprocessing with Sharp
├── package.json
├── tsconfig.json
├── .env.example           # Example environment file
└── README.md
```

## Image Processing

Images are preprocessed before sending to GPT-4o:

1. **Resize**: Longest side capped at 1500px (preserves aspect ratio)
2. **Format**: Converted to WebP for efficient transmission
3. **Quality**: 85% quality (good balance of size vs clarity)

This keeps API costs reasonable while maintaining OCR accuracy.

## Error Handling

All errors return JSON in this format:

```json
{
  "error": "Error description",
  "details": "Additional details if available"
}
```

Common HTTP status codes:
- `400` - Bad request (missing file, invalid format)
- `500` - Server error (OpenAI API error, processing failed)

## Cost Considerations

GPT-4o Vision pricing (as of 2024):
- Input: ~$2.50 per 1M tokens
- Output: ~$10.00 per 1M tokens
- Images: Counted as tokens based on size

A typical screenshot OCR costs ~$0.01-0.05 depending on image complexity.

## License

MIT

