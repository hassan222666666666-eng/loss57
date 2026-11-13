export interface ProductAnalysisItem {
  standardized_name: string;
  units_present: number;
  missing_units: number;
  confidence: number;
  bounding_box: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  barcode?: string;
  isReviewed?: boolean;
}

export interface ShelfAnalysisResult {
  shelf_match_id: string | null;
  focused_shelf_label?: string;
  focused_shelf_box?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  products: ProductAnalysisItem[];
  rawResponse?: string;
  analyzedAt: number;
}

export interface PhotoRecord {
  id: string;
  sessionId: string;
  timestamp: number;
  dataUrl: string;
  width: number;
  height: number;
  shelfCapacity: number | null;
  isGoldenReference: boolean;
  notes?: string;
  aisle?: string;
  shelfNumber?: string;
  // Stage 2: Gemini Vision & Queue additions
  analysisStatus?: 'pending' | 'analyzing' | 'completed' | 'error';
  analysisResult?: ShelfAnalysisResult | null;
  analysisError?: string;
  shelfMatchId?: string | null;
}

export interface RestockSession {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  photoCount: number;
  status: 'active' | 'completed';
}

export interface ShelfCorrection {
  productName: string;
  previousMissing: number;
  correctedMissing: number;
  timestamp: number;
}

export interface ShelfRecord {
  id: string;
  name: string;
  aisle?: string;
  shelfNumber?: string;
  goldenPhotoId?: string | null;
  goldenPhotoDataUrl?: string | null;
  fullCapacity?: number | null;
  productNames: string[];
  recentCorrections: ShelfCorrection[];
  createdAt: number;
  updatedAt: number;
}

export interface ProductRecord {
  id: string;
  standardizedName: string;
  barcode?: string;
  shelfId?: string;
  defaultCapacity?: number;
  lastSeen: number;
}

export interface LogEntry {
  id: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
  photoId: string;
  sessionId: string;
  shelfId?: string;
  shelfName?: string;
  productName: string;
  unitsPresent: number;
  missingUnits: number;
  confidence: number;
  boundingBox: [number, number, number, number];
  isReviewed: boolean;
  barcode?: string;
  // Stage 3: Two-Step Fulfillment Checklist
  isCollected?: boolean; // Step 1: Collected from warehouse
  collectedAt?: number;
  isPlaced?: boolean; // Step 2: Placed on supermarket shelf
  placedAt?: number;
}

export interface DailyPickItem {
  date: string; // YYYY-MM-DD
  productName: string;
  totalMissingUnits: number;
  sourcePhotoIds: string[];
  shelfNames: string[];
  barcode?: string;
  minConfidence: number;
  needsReview: boolean;
  isCollected: boolean;
  isPlaced: boolean;
  entries: LogEntry[];
}

export interface DailyPickGroup {
  date: string; // YYYY-MM-DD
  label: string;
  totalMissingUnits: number;
  collectedCount: number;
  placedCount: number;
  items: DailyPickItem[];
}

export interface ConsumptionHistoryRecord {
  id: string;
  date: string; // YYYY-MM-DD
  timestamp: number;
  photoId: string;
  shelfId?: string;
  shelfName?: string;
  productName: string;
  unitsPresent: number;
  missingUnits: number;
  estimatedCapacity: number;
  restockRatio: number; // 0.0 to 1.0 (missing / capacity)
}

export interface ShelfMatchCandidate {
  id: string;
  name: string;
  aisle?: string;
  shelfNumber?: string;
  fullCapacity?: number | null;
  productNames: string[];
}

export interface AppSettings {
  continuousCapture: boolean;
  askShelfCapacity: boolean;
  useGoldenReference: boolean;
  shutterSound: boolean;
  theme: 'system' | 'light' | 'dark';
  compressionMaxWidth: number;
  compressionQuality: number;
  smartTorch: boolean;
  smartZoom: boolean;
  autoAnalyzeQueue: boolean; // Auto process queue in background
  fastAnalysisMode: boolean; // Send single photo when capacity known + focus on missing items
  singleShelfFocusMode: boolean; // Automatically isolate and analyze only ONE primary horizontal shelf
  analysisPaceMode: 'safe' | 'fast' | 'parallel'; // Queue rate limit / concurrency strategy
}

export const DEFAULT_SETTINGS: AppSettings = {
  continuousCapture: true,
  askShelfCapacity: false,
  useGoldenReference: true,
  shutterSound: true,
  theme: 'system',
  compressionMaxWidth: 1280,
  compressionQuality: 0.8,
  smartTorch: true,
  smartZoom: true,
  autoAnalyzeQueue: true,
  fastAnalysisMode: true,
  singleShelfFocusMode: true,
  analysisPaceMode: 'fast',
};


