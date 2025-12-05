/**
 * Excel/CSV Workbook Analyzer
 * 
 * Parses Excel and CSV files to extract structure, stats, and chart candidates
 * WITHOUT sending full data to GPT - only metadata and samples.
 * 
 * Features:
 * - Detects categorical vs numeric columns (coded survey responses)
 * - Extracts codebook from Description sheets
 * - Extracts chart/graph images and analyzes with GPT-4o Vision
 * - Parses values to proper types
 */

import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeImageWithGPT } from './openai.js';
import { preprocessImageToBase64 } from './image.js';
import { renderChartFromXml } from './chartRenderer.js';

// Directory to save rendered charts
const CHART_OUTPUT_DIR = './rendered_charts';

// ============ Types ============

export interface ExcelAnalysisRequest {
  buffer: Buffer;
  filename: string;
}

export interface ColumnInfo {
  header: string;
  type: 'numeric' | 'categorical' | 'text' | 'date' | 'boolean';
  uniqueValues?: number;
  codes?: Record<string, string>; // For categorical: code -> label mapping
}

export interface ColumnStats {
  min: number;
  max: number;
  avg: number;
  uniqueCount?: number;
}

export interface ExcelSheetSummary {
  name: string;
  rowCount: number;
  columns: Record<string, ColumnInfo>; // A, B, C -> column info
  stats?: Record<string, ColumnStats>; // Only for numeric columns
  sample: Array<Record<string, any>>; // 3 sample rows, parsed values
}

export interface Codebook {
  [columnName: string]: string; // Column name -> description
}

export interface ChartInfo {
  sheetName: string;
  chartType?: string; // bar, line, pie, scatter, etc.
  title?: string;
  xAxis?: string;
  yAxis?: string;
  series?: string[];
  dataRange?: string;
  imageFile?: string; // filename in xlsx
  analysis?: string; // GPT-4o Vision analysis
}

export interface ChartAnalysisResult {
  charts: ChartInfo[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export interface ExcelWorkbookSummary {
  workbook: string;
  sheets: ExcelSheetSummary[];
  codebook?: Codebook; // Extracted from Description sheet if present
  charts?: ChartInfo[]; // Embedded charts found in the workbook (with GPT-4o analysis)
  chartAnalysisUsage?: { // Token usage for chart image analysis
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

// ============ Type Detection ============

type RawColumnType = 'numeric' | 'categorical' | 'text' | 'date' | 'boolean';

const CATEGORICAL_MAX_UNIQUE = 20; // If numeric has <= 20 unique values, treat as categorical

/**
 * Detect the type of a column based on sample values
 * Now distinguishes between pure numeric and categorical (coded) columns
 */
function detectColumnType(values: any[], allValues: any[]): { type: RawColumnType; uniqueCount?: number } {
  const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '');
  
  if (nonNullValues.length === 0) return { type: 'text' };
  
  let numericCount = 0;
  let dateCount = 0;
  let booleanCount = 0;
  let textCount = 0;
  
  for (const val of nonNullValues) {
    if (typeof val === 'boolean' || val === 'true' || val === 'false' || val === 'TRUE' || val === 'FALSE') {
      booleanCount++;
    } else if (typeof val === 'number' && !isNaN(val)) {
      numericCount++;
    } else if (val instanceof Date) {
      dateCount++;
    } else if (typeof val === 'string') {
      const num = parseFloat(val.replace(/[,$%]/g, ''));
      if (!isNaN(num) && val.trim() !== '') {
        numericCount++;
      } else if (isDateString(val)) {
        dateCount++;
      } else {
        textCount++;
      }
    } else {
      textCount++;
    }
  }
  
  const total = nonNullValues.length;
  const threshold = 0.8;
  
  if (booleanCount / total >= threshold) return { type: 'boolean' };
  if (dateCount / total >= threshold) return { type: 'date' };
  if (textCount / total >= threshold) return { type: 'text' };
  
  // Check if numeric - but also check if it's categorical (few unique values)
  if (numericCount / total >= threshold) {
    // Get unique values from ALL data (not just sample)
    const uniqueNums = new Set(
      allValues
        .map(v => extractNumericValue(v))
        .filter((n): n is number => n !== null)
    );
    
    const uniqueCount = uniqueNums.size;
    
    // If few unique integers, likely categorical codes (1-5 Likert, 1-8 Major, etc.)
    if (uniqueCount <= CATEGORICAL_MAX_UNIQUE) {
      // Check if all values are integers
      const allIntegers = [...uniqueNums].every(n => Number.isInteger(n));
      if (allIntegers) {
        return { type: 'categorical', uniqueCount };
      }
    }
    
    return { type: 'numeric', uniqueCount };
  }
  
  return { type: 'text' };
}

/**
 * Check if a string looks like a date
 */
function isDateString(str: string): boolean {
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}$/,
    /^\d{2}\/\d{2}\/\d{4}$/,
    /^\d{2}-\d{2}-\d{4}$/,
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
  ];
  return datePatterns.some(pattern => pattern.test(str.trim()));
}

/**
 * Extract numeric value from a cell
 */
function extractNumericValue(val: any): number | null {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[,$%\s]/g, '');
    const num = parseFloat(cleaned);
    if (!isNaN(num)) return num;
  }
  return null;
}

/**
 * Parse a value to its proper type
 */
function parseValue(val: any): any {
  if (val === null || val === undefined || val === '') return null;
  
  // Try to parse as number
  const num = extractNumericValue(val);
  if (num !== null) return num;
  
  // Return as-is (string)
  return val;
}

/**
 * Calculate stats for a numeric column
 */
function calculateStats(values: any[]): ColumnStats | null {
  const numbers = values
    .map(extractNumericValue)
    .filter((n): n is number => n !== null);
  
  if (numbers.length === 0) return null;
  
  const uniqueSet = new Set(numbers);
  
  return {
    min: Math.round(Math.min(...numbers) * 100) / 100,
    max: Math.round(Math.max(...numbers) * 100) / 100,
    avg: Math.round((numbers.reduce((sum, n) => sum + n, 0) / numbers.length) * 100) / 100,
    uniqueCount: uniqueSet.size,
  };
}

// ============ Codebook Extraction ============

const DESCRIPTION_SHEET_PATTERNS = [
  /^description$/i,
  /^codebook$/i,
  /^codes$/i,
  /^legend$/i,
  /^metadata$/i,
  /^info$/i,
  /^variables$/i,
];

/**
 * Try to extract a codebook from a description sheet
 */
function extractCodebook(data: any[][]): Codebook | null {
  if (data.length < 2) return null;
  
  const codebook: Codebook = {};
  
  // Try to find column name -> description pairs
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 2) continue;
    
    // Look for patterns like: "Column A" | "Credit Hours" | "Number of credit hours"
    // Or: "Credit Hours" | "Number of credit hours this term"
    const firstCell = String(row[0] || '').trim();
    const secondCell = String(row[1] || '').trim();
    const thirdCell = row[2] ? String(row[2]).trim() : '';
    
    // Skip header rows
    if (firstCell.toLowerCase().includes('column') && secondCell.toLowerCase().includes('variable')) {
      continue;
    }
    
    // If first cell looks like a column letter reference, use second cell as name
    if (/^column\s*[a-z]$/i.test(firstCell) && secondCell) {
      codebook[secondCell] = thirdCell || secondCell;
    }
    // Otherwise, first cell is name, second is description
    else if (firstCell && secondCell && !firstCell.toLowerCase().startsWith('column')) {
      codebook[firstCell] = secondCell;
    }
  }
  
  return Object.keys(codebook).length > 0 ? codebook : null;
}

/**
 * Get column letter from index (0 = A, 1 = B, ... 26 = AA)
 */
function getColumnLetter(index: number): string {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

// ============ Chart Extraction ============

/**
 * Extract embedded charts from an Excel workbook
 * SheetJS stores chart info in various places depending on the Excel version
 */
function extractCharts(workbook: XLSX.WorkBook): ChartInfo[] {
  const charts: ChartInfo[] = [];
  
  // Check for chart sheets (sheets that are entirely charts)
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    
    // Check if sheet has chart indicators
    // SheetJS marks chart sheets or sheets with drawings
    if (sheet['!type'] === 'chart') {
      charts.push({
        sheetName,
        chartType: 'chart_sheet',
        title: sheetName,
      });
      console.log(`[Excel] Found chart sheet: "${sheetName}"`);
    }
    
    // Check for drawings/charts embedded in sheet
    // @ts-ignore - accessing internal SheetJS properties
    const drawings = sheet['!drawings'] || sheet['!charts'] || sheet['!objects'];
    if (drawings) {
      console.log(`[Excel] Found drawings in sheet "${sheetName}":`, typeof drawings);
      if (Array.isArray(drawings)) {
        for (const drawing of drawings) {
          charts.push({
            sheetName,
            chartType: drawing.type || 'embedded',
            title: drawing.title || drawing.name || `Chart in ${sheetName}`,
            dataRange: drawing.range || undefined,
          });
        }
      } else if (typeof drawings === 'object') {
        charts.push({
          sheetName,
          chartType: 'embedded',
          title: `Chart in ${sheetName}`,
        });
      }
    }
  }
  
  // Check workbook-level chart references
  // @ts-ignore - accessing internal SheetJS properties
  const wbSheets = (workbook as any).Workbook?.Sheets;
  if (wbSheets && Array.isArray(wbSheets)) {
    const wbCharts = wbSheets.filter((s: any) => s.chartType);
    for (const chartSheet of wbCharts) {
      charts.push({
        sheetName: chartSheet.name || 'Unknown',
        chartType: chartSheet.chartType || 'unknown',
        title: chartSheet.name,
      });
    }
  }
  
  // Check for chart files in the xlsx structure
  // @ts-ignore - accessing internal SheetJS properties
  const files = workbook.files || workbook.vbaraw || {};
  const chartFiles = Object.keys(files).filter(f => f.includes('chart') || f.includes('drawing'));
  if (chartFiles.length > 0) {
    console.log(`[Excel] Found chart-related files:`, chartFiles);
    // Parse chart XML if available
    for (const chartFile of chartFiles) {
      if (chartFile.endsWith('.xml') && chartFile.includes('chart')) {
        const chartInfo = parseChartXML(files[chartFile], chartFile);
        if (chartInfo) {
          charts.push(chartInfo);
        }
      }
    }
  }
  
  return charts;
}

/**
 * Parse chart information from XML content
 */
function parseChartXML(xmlContent: any, filename: string): ChartInfo | null {
  try {
    // Convert to string if buffer
    const xmlStr = typeof xmlContent === 'string' 
      ? xmlContent 
      : xmlContent.toString ? xmlContent.toString() : String(xmlContent);
    
    // Extract chart type from XML
    let chartType = 'unknown';
    if (xmlStr.includes('<c:barChart')) chartType = 'bar';
    else if (xmlStr.includes('<c:lineChart')) chartType = 'line';
    else if (xmlStr.includes('<c:pieChart')) chartType = 'pie';
    else if (xmlStr.includes('<c:scatterChart')) chartType = 'scatter';
    else if (xmlStr.includes('<c:areaChart')) chartType = 'area';
    else if (xmlStr.includes('<c:doughnutChart')) chartType = 'doughnut';
    else if (xmlStr.includes('<c:radarChart')) chartType = 'radar';
    
    // Try to extract title
    const titleMatch = xmlStr.match(/<c:title>.*?<a:t>([^<]+)<\/a:t>/s);
    const title = titleMatch ? titleMatch[1] : undefined;
    
    // Try to extract axis labels
    const xAxisMatch = xmlStr.match(/<c:catAx>.*?<c:title>.*?<a:t>([^<]+)<\/a:t>/s);
    const yAxisMatch = xmlStr.match(/<c:valAx>.*?<c:title>.*?<a:t>([^<]+)<\/a:t>/s);
    
    return {
      sheetName: filename.replace(/.*\//, '').replace('.xml', ''),
      chartType,
      title,
      xAxis: xAxisMatch ? xAxisMatch[1] : undefined,
      yAxis: yAxisMatch ? yAxisMatch[1] : undefined,
    };
  } catch (e) {
    console.error(`[Excel] Failed to parse chart XML:`, e);
    return null;
  }
}

// ============ Chart Image Extraction & Analysis ============

const CHART_ANALYSIS_SYSTEM_PROMPT = `You are analyzing a chart/graph image from an Excel spreadsheet. 
Describe:
1. Chart type (bar, line, pie, scatter, etc.)
2. What data it's showing (axes, labels, legend)
3. Key trends or insights visible
4. Any notable values or outliers

Be concise but informative. Output as JSON:
{
  "chartType": "bar|line|pie|scatter|area|other",
  "title": "chart title if visible",
  "xAxis": "x-axis label/meaning",
  "yAxis": "y-axis label/meaning", 
  "series": ["series names if multiple"],
  "insights": "key observations about the data shown"
}`;

const CHART_ANALYSIS_USER_PROMPT = `Analyze this chart/graph image from an Excel file. Describe what it shows and any insights.`;

interface XlsxExtractResult {
  images: Array<{ filename: string; data: Buffer; mimeType: string }>;
  chartXmls: Array<{ filename: string; content: string }>;
}

/**
 * Extract images AND chart XML from xlsx file
 */
function extractFromXlsx(buffer: Buffer): XlsxExtractResult {
  const images: Array<{ filename: string; data: Buffer; mimeType: string }> = [];
  const chartXmls: Array<{ filename: string; content: string }> = [];
  
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    
    for (const entry of entries) {
      const name = entry.entryName.toLowerCase();
      
      // Extract chart XML files
      if (name.includes('/charts/chart') && name.endsWith('.xml')) {
        const content = entry.getData().toString('utf-8');
        chartXmls.push({
          filename: entry.entryName,
          content,
        });
        console.log(`[Excel] Found chart XML: ${entry.entryName}`);
      }
      
      // Extract images
      if (name.includes('/media/') || name.includes('/charts/') || name.includes('/drawings/')) {
        const ext = name.split('.').pop() || '';
        
        if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'emf', 'wmf'].includes(ext)) {
          const data = entry.getData();
          let mimeType = 'image/png';
          if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
          else if (ext === 'gif') mimeType = 'image/gif';
          else if (ext === 'bmp') mimeType = 'image/bmp';
          
          images.push({ filename: entry.entryName, data, mimeType });
          console.log(`[Excel] Found image: ${entry.entryName} (${(data.length / 1024).toFixed(1)}KB)`);
        }
      }
    }
    
    if (chartXmls.length === 0 && images.length === 0) {
      console.log(`[Excel] No charts or images found in xlsx`);
    }
    
  } catch (e) {
    console.error('[Excel] Failed to extract from xlsx:', e);
  }
  
  return { images, chartXmls };
}

/**
 * Parse chart XML to extract chart metadata
 */
function parseChartXmlToInfo(filename: string, xml: string): ChartInfo {
  const info: ChartInfo = {
    sheetName: filename.replace(/.*\//, '').replace('.xml', ''),
    imageFile: filename,
  };
  
  // Detect chart type
  if (xml.includes('<c:barChart')) info.chartType = 'bar';
  else if (xml.includes('<c:bar3DChart')) info.chartType = 'bar3D';
  else if (xml.includes('<c:lineChart')) info.chartType = 'line';
  else if (xml.includes('<c:line3DChart')) info.chartType = 'line3D';
  else if (xml.includes('<c:pieChart')) info.chartType = 'pie';
  else if (xml.includes('<c:pie3DChart')) info.chartType = 'pie3D';
  else if (xml.includes('<c:doughnutChart')) info.chartType = 'doughnut';
  else if (xml.includes('<c:scatterChart')) info.chartType = 'scatter';
  else if (xml.includes('<c:areaChart')) info.chartType = 'area';
  else if (xml.includes('<c:radarChart')) info.chartType = 'radar';
  else if (xml.includes('<c:bubbleChart')) info.chartType = 'bubble';
  else info.chartType = 'unknown';
  
  // Extract title
  const titleMatch = xml.match(/<c:title>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
  if (titleMatch) info.title = titleMatch[1];
  
  // Extract axis titles
  const catAxisMatch = xml.match(/<c:catAx>[\s\S]*?<c:title>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
  if (catAxisMatch) info.xAxis = catAxisMatch[1];
  
  const valAxisMatch = xml.match(/<c:valAx>[\s\S]*?<c:title>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
  if (valAxisMatch) info.yAxis = valAxisMatch[1];
  
  // Extract data series references (e.g., "Sheet1!$B$1:$B$10")
  const seriesRefs: string[] = [];
  const seriesMatches = xml.matchAll(/<c:f>([^<]+)<\/c:f>/g);
  for (const match of seriesMatches) {
    const ref = match[1];
    if (ref && !seriesRefs.includes(ref) && seriesRefs.length < 5) {
      seriesRefs.push(ref);
    }
  }
  if (seriesRefs.length > 0) {
    info.dataRange = seriesRefs.join(', ');
  }
  
  // Extract series names/labels
  const seriesNames: string[] = [];
  const nameMatches = xml.matchAll(/<c:tx>[\s\S]*?<c:v>([^<]+)<\/c:v>/g);
  for (const match of nameMatches) {
    const name = match[1];
    if (name && !seriesNames.includes(name) && seriesNames.length < 10) {
      seriesNames.push(name);
    }
  }
  if (seriesNames.length > 0) {
    info.series = seriesNames;
  }
  
  // Build analysis text describing the chart
  let analysis = `${info.chartType?.toUpperCase() || 'Unknown'} chart`;
  if (info.title) analysis += ` titled "${info.title}"`;
  if (info.series && info.series.length > 0) {
    analysis += `. Series: ${info.series.join(', ')}`;
  }
  if (info.xAxis) analysis += `. X-axis: ${info.xAxis}`;
  if (info.yAxis) analysis += `. Y-axis: ${info.yAxis}`;
  if (info.dataRange) analysis += `. Data from: ${info.dataRange}`;
  
  info.analysis = analysis;
  
  return info;
}

/**
 * Analyze chart images with GPT-4o Vision
 */
async function analyzeChartImages(
  images: Array<{ filename: string; data: Buffer; mimeType: string }>
): Promise<ChartAnalysisResult> {
  const charts: ChartInfo[] = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  
  for (const image of images) {
    try {
      console.log(`[Excel] Analyzing chart image: ${image.filename}`);
      
      // Preprocess image (resize, convert to base64)
      const processed = await preprocessImageToBase64(image.data);
      
      // Send to GPT-4o Vision
      const result = await analyzeImageWithGPT({
        imageBase64: processed.base64,
        systemPrompt: CHART_ANALYSIS_SYSTEM_PROMPT,
        userPrompt: CHART_ANALYSIS_USER_PROMPT,
      });
      
      // Parse the JSON response
      let chartInfo: ChartInfo = {
        sheetName: 'Chart',
        imageFile: image.filename,
        analysis: result.text,
      };
      
      // Try to parse structured response
      try {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          chartInfo = {
            ...chartInfo,
            chartType: parsed.chartType,
            title: parsed.title,
            xAxis: parsed.xAxis,
            yAxis: parsed.yAxis,
            series: parsed.series,
            analysis: parsed.insights || result.text,
          };
        }
      } catch (parseError) {
        // Keep raw analysis if JSON parsing fails
        console.log('[Excel] Could not parse chart analysis as JSON, using raw text');
      }
      
      charts.push(chartInfo);
      
      // Accumulate usage
      totalUsage.input_tokens += result.usage.input_tokens;
      totalUsage.output_tokens += result.usage.output_tokens;
      totalUsage.total_tokens += result.usage.total_tokens;
      
      console.log(`[Excel] Chart analysis complete: ${chartInfo.chartType || 'unknown'} chart`);
      
    } catch (e) {
      console.error(`[Excel] Failed to analyze image ${image.filename}:`, e);
      charts.push({
        sheetName: 'Chart',
        imageFile: image.filename,
        analysis: 'Failed to analyze chart image',
      });
    }
  }
  
  return { charts, usage: totalUsage };
}

// ============ Main Analysis Function ============

/**
 * Analyze an Excel/CSV file and extract structured metadata
 */
export async function analyzeExcelStructure(
  input: ExcelAnalysisRequest
): Promise<ExcelWorkbookSummary> {
  const { buffer, filename } = input;
  
  console.log(`[Excel] Analyzing: ${filename}`);
  
  // Read with full options to capture charts and drawings
  // Using type assertion for options that may not be in type definitions
  const workbook = XLSX.read(buffer, { 
    type: 'buffer', 
    cellDates: true,
    bookVBA: true,       // Include VBA for completeness
    WTF: true,           // Include all internal data (helps with charts)
  } as XLSX.ParsingOptions);
  const workbookName = filename.replace(/\.(xlsx|xls|csv)$/i, '') || 'Workbook';
  
  const sheets: ExcelSheetSummary[] = [];
  let codebook: Codebook | null = null;
  
  // First pass: look for description/codebook sheet
  for (const sheetName of workbook.SheetNames) {
    if (DESCRIPTION_SHEET_PATTERNS.some(p => p.test(sheetName))) {
      const sheet = workbook.Sheets[sheetName];
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      codebook = extractCodebook(data);
      if (codebook) {
        console.log(`[Excel] Found codebook in sheet "${sheetName}"`);
      }
    }
  }
  
  // Second pass: analyze data sheets
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    
    const data: any[][] = XLSX.utils.sheet_to_json(sheet, { 
      header: 1, 
      defval: null,
      raw: true, // Get raw values for proper type detection
    });
    
    if (data.length < 2) {
      console.log(`[Excel] Skipping sheet "${sheetName}" - too few rows`);
      continue;
    }
    
    // Extract headers
    const headerRow = data[0] || [];
    const headers: string[] = headerRow.map((cell, idx) => {
      if (cell === null || cell === undefined || cell === '') {
        return `Column ${idx + 1}`;
      }
      return String(cell).trim();
    });
    
    // Find non-empty columns
    const dataRows = data.slice(1);
    const nonEmptyColumnIndices = headers.map((_, idx) => {
      const hasData = dataRows.some(row => 
        row[idx] !== null && row[idx] !== undefined && row[idx] !== ''
      );
      return hasData ? idx : -1;
    }).filter(idx => idx !== -1);
    
    if (nonEmptyColumnIndices.length === 0) {
      console.log(`[Excel] Skipping sheet "${sheetName}" - no data columns`);
      continue;
    }
    
    const rowCount = dataRows.filter(row => row.some(cell => cell !== null && cell !== undefined && cell !== '')).length;
    
    // Build columns info with A, B, C keys
    const columns: Record<string, ColumnInfo> = {};
    const stats: Record<string, ColumnStats> = {};
    
    const SAMPLE_SIZE = 100;
    
    for (const colIdx of nonEmptyColumnIndices) {
      const colLetter = getColumnLetter(colIdx);
      const colName = headers[colIdx];
      
      const sampleValues = dataRows.slice(0, SAMPLE_SIZE).map(row => row[colIdx]);
      const allValues = dataRows.map(row => row[colIdx]);
      
      const { type, uniqueCount } = detectColumnType(sampleValues, allValues);
      
      const colInfo: ColumnInfo = {
        header: colName,
        type,
      };
      
      if (uniqueCount !== undefined) {
        colInfo.uniqueValues = uniqueCount;
      }
      
      // Add description from codebook if available
      if (codebook && codebook[colName]) {
        // Could add description field here if needed
      }
      
      columns[colLetter] = colInfo;
      
      // Calculate stats for numeric columns only (not categorical)
      if (type === 'numeric') {
        const colStats = calculateStats(allValues);
        if (colStats) {
          stats[colName] = colStats;
        }
      }
    }
    
    // Build sample rows (3 rows, parsed values)
    const sample: Array<Record<string, any>> = [];
    const SAMPLE_ROW_COUNT = 3;
    
    for (let i = 0; i < Math.min(SAMPLE_ROW_COUNT, dataRows.length); i++) {
      const row = dataRows[i];
      const rowObj: Record<string, any> = {};
      
      for (const colIdx of nonEmptyColumnIndices) {
        const colName = headers[colIdx];
        rowObj[colName] = parseValue(row[colIdx]);
      }
      
      sample.push(rowObj);
    }
    
    const sheetSummary: ExcelSheetSummary = {
      name: sheetName,
      rowCount,
      columns,
      sample,
    };
    
    // Only add stats if there are any
    if (Object.keys(stats).length > 0) {
      sheetSummary.stats = stats;
    }
    
    sheets.push(sheetSummary);
    console.log(`[Excel] Sheet "${sheetName}": ${rowCount} rows, ${Object.keys(columns).length} columns`);
  }
  
  if (sheets.length === 0) {
    throw new Error('No valid sheets found in workbook');
  }
  
  // Extract charts and images from xlsx
  const { images, chartXmls } = extractFromXlsx(buffer);
  let analyzedCharts: ChartInfo[] = [];
  let chartUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  
  // Get raw sheet data for chart rendering
  const firstDataSheet = workbook.SheetNames.find(name => {
    const sheet = workbook.Sheets[name];
    const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    return data.length > 2; // Has actual data
  });
  
  let sheetDataArray: any[][] = [];
  if (firstDataSheet) {
    const sheet = workbook.Sheets[firstDataSheet];
    sheetDataArray = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  }
  
  // Render chart XMLs to images and analyze with GPT-4o Vision
  for (const chartXml of chartXmls) {
    try {
      // First get basic metadata
      const chartInfo = parseChartXmlToInfo(chartXml.filename, chartXml.content);
      console.log(`[Excel] Found chart: ${chartInfo.chartType} - ${chartInfo.title || 'untitled'}`);
      
      // Try to render the chart as an image
      if (sheetDataArray.length > 0) {
        const renderResult = await renderChartFromXml(chartXml.content, sheetDataArray);
        
        if (renderResult) {
          console.log(`[Excel] Rendered chart image (${(renderResult.imageBuffer.length / 1024).toFixed(1)}KB)`);
          
          // Save rendered chart to disk for comparison
          try {
            if (!fs.existsSync(CHART_OUTPUT_DIR)) {
              fs.mkdirSync(CHART_OUTPUT_DIR, { recursive: true });
            }
            const chartFilename = `${workbookName}_${chartInfo.chartType || 'chart'}_${Date.now()}.png`;
            const chartPath = path.join(CHART_OUTPUT_DIR, chartFilename);
            fs.writeFileSync(chartPath, renderResult.imageBuffer);
            console.log(`[Excel] ✅ Chart saved to: ${chartPath}`);
          } catch (saveErr) {
            console.error(`[Excel] Failed to save chart:`, saveErr);
          }
          
          // Analyze the rendered chart with GPT-4o Vision
          try {
            const processed = await preprocessImageToBase64(renderResult.imageBuffer);
            const result = await analyzeImageWithGPT({
              imageBase64: processed.base64,
              systemPrompt: CHART_ANALYSIS_SYSTEM_PROMPT,
              userPrompt: CHART_ANALYSIS_USER_PROMPT,
            });
            
            // Parse response and update chart info
            chartInfo.analysis = result.text;
            try {
              const jsonMatch = result.text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.insights) chartInfo.analysis = parsed.insights;
              }
            } catch { /* keep raw text */ }
            
            chartUsage.input_tokens += result.usage.input_tokens;
            chartUsage.output_tokens += result.usage.output_tokens;
            chartUsage.total_tokens += result.usage.total_tokens;
            
            console.log(`[Excel] Chart analyzed by GPT-4o Vision`);
          } catch (e) {
            console.error(`[Excel] Failed to analyze rendered chart:`, e);
          }
        }
      }
      
      analyzedCharts.push(chartInfo);
    } catch (e) {
      console.error(`[Excel] Failed to process chart ${chartXml.filename}:`, e);
    }
  }
  
  // If there are pre-existing images (not rendered), also analyze them
  if (images.length > 0) {
    console.log(`[Excel] Found ${images.length} embedded image(s) to analyze`);
    const analysisResult = await analyzeChartImages(images);
    analyzedCharts = [...analyzedCharts, ...analysisResult.charts];
    chartUsage.input_tokens += analysisResult.usage.input_tokens;
    chartUsage.output_tokens += analysisResult.usage.output_tokens;
    chartUsage.total_tokens += analysisResult.usage.total_tokens;
  }
  
  const result: ExcelWorkbookSummary = {
    workbook: workbookName,
    sheets,
  };
  
  if (codebook) {
    result.codebook = codebook;
  }
  
  if (analyzedCharts.length > 0) {
    result.charts = analyzedCharts;
  }
  
  if (chartUsage.total_tokens > 0) {
    result.chartAnalysisUsage = chartUsage;
  }
  
  return result;
}
