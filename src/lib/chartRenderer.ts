/**
 * Chart Renderer - Robust Excel Chart Reconstruction
 * 
 * Renders Excel charts from XML definitions + actual data
 * using Chart.js and chartjs-node-canvas
 * 
 * Handles:
 * - Bar/Column charts (horizontal & vertical)
 * - Line charts
 * - Pie/Doughnut charts
 * - Area charts
 * - Scatter plots
 * - Stacked charts
 * - Multiple series
 */

import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration, ChartType, ChartOptions } from 'chart.js';

// Chart canvas configuration
const CHART_WIDTH = 800;
const CHART_HEIGHT = 600;

const chartJSNodeCanvas = new ChartJSNodeCanvas({ 
  width: CHART_WIDTH, 
  height: CHART_HEIGHT,
  backgroundColour: 'white',
});

// Excel-like color palette
const CHART_COLORS = [
  '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5',
  '#70AD47', '#264478', '#9E480E', '#636363', '#997300',
  '#255E91', '#43682B', '#698ED0', '#F1975A', '#B7B7B7'
];

// ============ Types ============

export interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'area' | 'radar';
  horizontal: boolean;
  stacked: boolean;
  title?: string;
  xAxisTitle?: string;
  yAxisTitle?: string;
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    color?: string;
  }>;
}

export interface ChartRenderResult {
  imageBuffer: Buffer;
  chartData: ChartData;
}

interface ParsedChartInfo {
  chartType: string;
  horizontal: boolean;
  stacked: boolean;
  title?: string;
  xAxisTitle?: string;
  yAxisTitle?: string;
  categoryRef?: string;
  seriesRefs: Array<{ name?: string; valueRef: string; color?: string }>;
}

// ============ Cell Reference Parsing ============

/**
 * Parse Excel cell reference (e.g., "Sheet1!$B$2:$B$10" or "'Sheet Name'!$B$2:$B$10")
 */
function parseCellReference(ref: string): { sheet?: string; range: string } {
  // Handle quoted sheet names: 'Sheet Name'!$A$1:$A$10
  const quotedMatch = ref.match(/^'([^']+)'!(.+)$/);
  if (quotedMatch) {
    return { sheet: quotedMatch[1], range: quotedMatch[2] };
  }
  
  // Handle unquoted: Sheet1!$A$1:$A$10
  const parts = ref.split('!');
  if (parts.length === 2) {
    return { sheet: parts[0], range: parts[1] };
  }
  
  return { range: ref };
}

/**
 * Parse a range string to get column and row indices
 * Handles: $A$1:$A$10, A1:A10, $A$1, A1
 */
function parseRange(range: string): { 
  startCol: number; startRow: number; 
  endCol: number; endRow: number;
  isSingleCell: boolean;
} | null {
  const cleaned = range.replace(/\$/g, '');
  
  // Try range format: A1:B10
  const rangeMatch = cleaned.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (rangeMatch) {
    return {
      startCol: colToNum(rangeMatch[1]),
      startRow: parseInt(rangeMatch[2]) - 1,
      endCol: colToNum(rangeMatch[3]),
      endRow: parseInt(rangeMatch[4]) - 1,
      isSingleCell: false,
    };
  }
  
  // Try single cell format: A1
  const cellMatch = cleaned.match(/^([A-Z]+)(\d+)$/i);
  if (cellMatch) {
    const col = colToNum(cellMatch[1]);
    const row = parseInt(cellMatch[2]) - 1;
    return {
      startCol: col, startRow: row,
      endCol: col, endRow: row,
      isSingleCell: true,
    };
  }
  
  return null;
}

function colToNum(col: string): number {
  let num = 0;
  const upper = col.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    num = num * 26 + (upper.charCodeAt(i) - 64);
  }
  return num - 1;
}

/**
 * Extract data from sheet based on cell reference
 */
function extractDataFromSheet(sheetData: any[][], reference: string): (string | number)[] {
  const { range } = parseCellReference(reference);
  const parsed = parseRange(range);
  
  if (!parsed) {
    console.log(`[ChartRenderer] Could not parse range: ${reference}`);
    return [];
  }
  
  const values: (string | number)[] = [];
  
  if (parsed.isSingleCell) {
    // Single cell
    if (sheetData[parsed.startRow]?.[parsed.startCol] != null) {
      values.push(sheetData[parsed.startRow][parsed.startCol]);
    }
  } else if (parsed.startCol === parsed.endCol) {
    // Column range (vertical)
    for (let row = parsed.startRow; row <= parsed.endRow && row < sheetData.length; row++) {
      const val = sheetData[row]?.[parsed.startCol];
      if (val !== null && val !== undefined && val !== '') {
        values.push(val);
      }
    }
  } else if (parsed.startRow === parsed.endRow) {
    // Row range (horizontal)
    for (let col = parsed.startCol; col <= parsed.endCol; col++) {
      const val = sheetData[parsed.startRow]?.[col];
      if (val !== null && val !== undefined && val !== '') {
        values.push(val);
      }
    }
  } else {
    // 2D range - flatten column by column
    for (let col = parsed.startCol; col <= parsed.endCol; col++) {
      for (let row = parsed.startRow; row <= parsed.endRow && row < sheetData.length; row++) {
        const val = sheetData[row]?.[col];
        if (val !== null && val !== undefined && val !== '') {
          values.push(val);
        }
      }
    }
  }
  
  return values;
}

// ============ XML Parsing ============

/**
 * Parse chart XML and extract all relevant information
 */
export function parseChartXml(xml: string): ParsedChartInfo {
  const info: ParsedChartInfo = {
    chartType: 'bar',
    horizontal: false,
    stacked: false,
    seriesRefs: [],
  };
  
  // Detect chart type and properties
  if (xml.includes('<c:barChart')) {
    info.chartType = 'bar';
    // Check direction: bar = horizontal, col = vertical
    const dirMatch = xml.match(/<c:barDir\s+val="([^"]+)"/);
    info.horizontal = dirMatch?.[1] === 'bar';
  } else if (xml.includes('<c:bar3DChart')) {
    info.chartType = 'bar';
    const dirMatch = xml.match(/<c:barDir\s+val="([^"]+)"/);
    info.horizontal = dirMatch?.[1] === 'bar';
  } else if (xml.includes('<c:lineChart') || xml.includes('<c:line3DChart')) {
    info.chartType = 'line';
  } else if (xml.includes('<c:pieChart') || xml.includes('<c:pie3DChart')) {
    info.chartType = 'pie';
  } else if (xml.includes('<c:doughnutChart')) {
    info.chartType = 'doughnut';
  } else if (xml.includes('<c:scatterChart')) {
    info.chartType = 'scatter';
  } else if (xml.includes('<c:areaChart') || xml.includes('<c:area3DChart')) {
    info.chartType = 'area';
  } else if (xml.includes('<c:radarChart')) {
    info.chartType = 'radar';
  }
  
  // Check if stacked
  const groupingMatch = xml.match(/<c:grouping\s+val="([^"]+)"/);
  info.stacked = groupingMatch?.[1] === 'stacked' || groupingMatch?.[1] === 'percentStacked';
  
  // Extract chart title
  const titleMatch = xml.match(/<c:title>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
  if (titleMatch) {
    info.title = titleMatch[1].trim();
  }
  
  // Extract axis titles
  const catAxisTitleMatch = xml.match(/<c:catAx>[\s\S]*?<c:title>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
  if (catAxisTitleMatch) {
    info.xAxisTitle = catAxisTitleMatch[1].trim();
  }
  
  const valAxisTitleMatch = xml.match(/<c:valAx>[\s\S]*?<c:title>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
  if (valAxisTitleMatch) {
    info.yAxisTitle = valAxisTitleMatch[1].trim();
  }
  
  // Extract category reference
  const catMatch = xml.match(/<c:cat>[\s\S]*?<c:f>([^<]+)<\/c:f>/);
  if (catMatch) {
    info.categoryRef = catMatch[1];
  }
  
  // Extract series
  const seriesRegex = /<c:ser>([\s\S]*?)<\/c:ser>/g;
  let seriesMatch;
  
  while ((seriesMatch = seriesRegex.exec(xml)) !== null) {
    const seriesXml = seriesMatch[1];
    
    // Get series name from <c:tx><c:strRef><c:strCache><c:pt><c:v> or <c:tx><c:v>
    let name: string | undefined;
    const nameMatch1 = seriesXml.match(/<c:tx>[\s\S]*?<c:v>([^<]+)<\/c:v>/);
    if (nameMatch1) name = nameMatch1[1];
    
    // Get value reference
    let valueRef: string | undefined;
    const valMatch = seriesXml.match(/<c:val>[\s\S]*?<c:f>([^<]+)<\/c:f>/);
    if (valMatch) valueRef = valMatch[1];
    
    // For scatter charts, Y values are in <c:yVal>
    if (!valueRef) {
      const yValMatch = seriesXml.match(/<c:yVal>[\s\S]*?<c:f>([^<]+)<\/c:f>/);
      if (yValMatch) valueRef = yValMatch[1];
    }
    
    // Get color if specified
    let color: string | undefined;
    const colorMatch = seriesXml.match(/<a:srgbClr\s+val="([^"]+)"/);
    if (colorMatch) {
      color = '#' + colorMatch[1];
    }
    
    if (valueRef) {
      info.seriesRefs.push({ name, valueRef, color });
    }
  }
  
  // If no title found, use first series name
  if (!info.title && info.seriesRefs.length > 0 && info.seriesRefs[0].name) {
    info.title = info.seriesRefs[0].name;
  }
  
  console.log(`[ChartRenderer] Parsed: ${info.chartType}, horizontal=${info.horizontal}, stacked=${info.stacked}, ${info.seriesRefs.length} series`);
  
  return info;
}

// ============ Chart Rendering ============

/**
 * Map Excel chart type to Chart.js type
 */
function mapChartType(excelType: string): ChartType {
  const typeMap: Record<string, ChartType> = {
    'bar': 'bar',
    'line': 'line',
    'pie': 'pie',
    'doughnut': 'doughnut',
    'scatter': 'scatter',
    'area': 'line',
    'radar': 'radar',
  };
  return typeMap[excelType] || 'bar';
}

/**
 * Build Chart.js configuration from parsed data
 */
function buildChartConfig(chartData: ChartData): ChartConfiguration {
  const chartJsType = mapChartType(chartData.type);
  const isHorizontal = chartData.horizontal && chartData.type === 'bar';
  const isPieType = chartData.type === 'pie' || chartData.type === 'doughnut';
  
  // Build datasets
  const datasets = chartData.datasets.map((ds, i) => {
    const baseColor = ds.color || CHART_COLORS[i % CHART_COLORS.length];
    
    return {
      label: ds.label,
      data: ds.data,
      backgroundColor: isPieType ? CHART_COLORS.slice(0, ds.data.length) : baseColor,
      borderColor: baseColor,
      borderWidth: chartData.type === 'line' ? 2 : 1,
      fill: chartData.type === 'area',
      tension: chartData.type === 'line' ? 0.1 : 0,
    };
  });
  
  // Build options
  const options: ChartOptions = {
    responsive: false,
    indexAxis: isHorizontal ? 'y' : 'x',
    plugins: {
      title: {
        display: !!chartData.title,
        text: chartData.title || '',
        font: { size: 16, weight: 'bold' },
        padding: { bottom: 10 },
      },
      legend: {
        display: chartData.datasets.length > 1 || isPieType,
        position: 'bottom',
      },
    },
  };
  
  // Add scales for non-pie charts
  if (!isPieType) {
    const xAxis: any = {
      beginAtZero: true,
      title: {
        display: !!chartData.xAxisTitle,
        text: chartData.xAxisTitle || '',
      },
      stacked: chartData.stacked,
    };
    
    const yAxis: any = {
      beginAtZero: true,
      title: {
        display: !!chartData.yAxisTitle,
        text: chartData.yAxisTitle || '',
      },
      stacked: chartData.stacked,
    };
    
    options.scales = { x: xAxis, y: yAxis };
  }
  
  return {
    type: chartJsType,
    data: {
      labels: chartData.labels,
      datasets,
    },
    options,
  };
}

/**
 * Render chart to PNG buffer
 */
export async function renderChart(chartData: ChartData): Promise<Buffer> {
  const config = buildChartConfig(chartData);
  const buffer = await chartJSNodeCanvas.renderToBuffer(config);
  return buffer;
}

/**
 * Build chart data from XML and Excel sheet data
 */
export function buildChartData(chartXml: string, sheetData: any[][]): ChartData | null {
  try {
    const parsed = parseChartXml(chartXml);
    
    // Extract labels (categories)
    let labels: string[] = [];
    if (parsed.categoryRef) {
      const catData = extractDataFromSheet(sheetData, parsed.categoryRef);
      labels = catData.map(v => String(v));
    }
    
    // Build datasets
    const datasets = parsed.seriesRefs.map(series => {
      const rawData = extractDataFromSheet(sheetData, series.valueRef);
      
      // Convert to numbers, filtering invalid values
      const data = rawData
        .map(v => {
          if (v === null || v === undefined || v === '') return NaN;
          const num = typeof v === 'number' ? v : parseFloat(String(v));
          return num;
        })
        .filter(n => !isNaN(n) && isFinite(n));
      
      return {
        label: series.name || 'Series',
        data,
        color: series.color,
      };
    }).filter(ds => ds.data.length > 0);
    
    if (datasets.length === 0) {
      console.log('[ChartRenderer] No valid datasets found');
      return null;
    }
    
    // Normalize data length across all datasets
    const dataLength = Math.min(...datasets.map(ds => ds.data.length));
    datasets.forEach(ds => {
      ds.data = ds.data.slice(0, dataLength);
    });
    
    // Generate labels if not found
    if (labels.length === 0) {
      labels = Array.from({ length: dataLength }, (_, i) => String(i + 1));
    } else {
      labels = labels.slice(0, dataLength);
    }
    
    console.log(`[ChartRenderer] Built: ${parsed.chartType}, ${datasets.length} series, ${dataLength} points, horizontal=${parsed.horizontal}`);
    
    return {
      type: parsed.chartType as ChartData['type'],
      horizontal: parsed.horizontal,
      stacked: parsed.stacked,
      title: parsed.title,
      xAxisTitle: parsed.xAxisTitle,
      yAxisTitle: parsed.yAxisTitle,
      labels,
      datasets,
    };
  } catch (e) {
    console.error('[ChartRenderer] Failed to build chart data:', e);
    return null;
  }
}

/**
 * Main entry point: render chart from XML and sheet data
 */
export async function renderChartFromXml(
  chartXml: string,
  sheetData: any[][]
): Promise<ChartRenderResult | null> {
  const chartData = buildChartData(chartXml, sheetData);
  
  if (!chartData) {
    return null;
  }
  
  console.log(`[ChartRenderer] Rendering ${chartData.type} chart (horizontal=${chartData.horizontal}) with ${chartData.datasets.length} series`);
  
  const imageBuffer = await renderChart(chartData);
  
  return {
    imageBuffer,
    chartData,
  };
}
