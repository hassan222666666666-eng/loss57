import {
  PhotoRecord,
  ShelfAnalysisResult,
  LogEntry,
  ProductRecord,
  ConsumptionHistoryRecord,
  ShelfMatchCandidate,
} from '../types';
import {
  getPendingPhotos,
  requeueErroredPhotos,
  recoverStuckAnalyzingPhotos,
  updatePhotoAnalysis,
  findOrCreateShelf,
  getShelf,
  getAllShelves,
  getSettings,
  saveLogEntries,
  deleteLogEntriesByPhotoId,
  saveConsumptionHistory,
  saveProduct,
  findProductByName,
  saveShelf,
} from './db';
import { downscaleImageForAnalysis } from '../utils/imageUtils';

export interface QueueProgressState {
  isProcessing: boolean;
  total: number;
  current: number;
  currentPhotoId: string | null;
  message: string;
}

type QueueListener = (state: QueueProgressState) => void;

class AnalysisQueueService {
  private isRunning = false;
  private rerunRequested = false;
  private rerunIncludeErrored = false;
  private listeners: Set<QueueListener> = new Set();
  private state: QueueProgressState = {
    isProcessing: false,
    total: 0,
    current: 0,
    currentPhotoId: null,
    message: '',
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', async () => {
        try {
          const settings = await getSettings();
          if (settings.autoAnalyzeQueue) {
            console.log('[Queue] Device is online! Auto-checking pending photos...');
            this.processQueue();
          }
        } catch {
          this.processQueue();
        }
      });
    }
  }

  public subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(updates: Partial<QueueProgressState>) {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach((l) => l(this.state));
  }

  public notifyQueueChanged() {
    this.listeners.forEach((l) => l(this.state));
  }

  public getState(): QueueProgressState {
    return this.state;
  }

  /**
   * Process single shelf photo via /api/analyze-shelf
   */
  public async analyzeSinglePhoto(photo: PhotoRecord): Promise<ShelfAnalysisResult | null> {
    try {
      await updatePhotoAnalysis(photo.id, 'analyzing');

      // 1. Resolve shelf context (either existing shelfMatchId or find/create by aisle/shelfNumber)
      const allShelves = await getAllShelves();
      let shelf =
        (photo.shelfMatchId ? await getShelf(photo.shelfMatchId) : null) ||
        (await findOrCreateShelf(photo.aisle, photo.shelfNumber));

      // 2. Look for Golden Reference Photo:
      // Optimization #1: When fastAnalysisMode is ON and shelf capacity + products are already known,
      // skip uploading the second golden photo (half the payload & vision latency).
      const settings = await getSettings();
      const fastMode = Boolean(settings.fastAnalysisMode);
      const hasLearnedShelfContext = Boolean(shelf.fullCapacity) && (shelf.productNames?.length || 0) > 0;
      let goldenPhotoDataUrl: string | undefined = undefined;
      if (
        settings.useGoldenReference &&
        !photo.isGoldenReference &&
        shelf.goldenPhotoDataUrl &&
        !(fastMode && hasLearnedShelfContext)
      ) {
        goldenPhotoDataUrl = shelf.goldenPhotoDataUrl;
      }

      // 3. Prepare knownShelves candidates (skip in fastMode if shelf is already identified with products)
      const knownShelves: ShelfMatchCandidate[] =
        fastMode && photo.shelfMatchId && hasLearnedShelfContext
          ? []
          : allShelves.map((s) => ({
              id: s.id,
              name: s.name,
              aisle: s.aisle,
              shelfNumber: s.shelfNumber,
              fullCapacity: s.fullCapacity,
              productNames: s.productNames || [],
            }));

      // 4. Downscale images lightly for fast Gemini Vision upload (IndexedDB retains full photo)
      const [lightPhotoUrl, lightGoldenUrl] = await Promise.all([
        downscaleImageForAnalysis(photo.dataUrl, fastMode ? 680 : 768, fastMode ? 0.68 : 0.72),
        goldenPhotoDataUrl
          ? downscaleImageForAnalysis(goldenPhotoDataUrl, 680, 0.62)
          : Promise.resolve(undefined),
      ]);

      // 5. Prepare payload with few-shot corrections and known products
      const payload = {
        photoDataUrl: lightPhotoUrl,
        goldenPhotoDataUrl: lightGoldenUrl,
        shelfId: shelf.id,
        fastMode,
        singleShelfFocusMode: settings.singleShelfFocusMode !== false,
        shelfContext: {
          aisle: shelf.aisle || photo.aisle,
          shelfNumber: shelf.shelfNumber || photo.shelfNumber,
          knownCapacity: shelf.fullCapacity || photo.shelfCapacity || null,
          knownProducts: shelf.productNames || [],
        },
        recentCorrections: (shelf.recentCorrections || []).slice(0, 3),
        knownShelves,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      let res: Response;
      try {
        res = await fetch('/api/analyze-shelf', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const contentType = res.headers.get('content-type') || '';
      const rawText = await res.text();
      const looksLikeHtml =
        rawText.trimStart().startsWith('<') || !contentType.toLowerCase().includes('application/json');

      let parsedBody: Record<string, unknown> | null = null;
      if (!looksLikeHtml && rawText.trim().length > 0) {
        try {
          parsedBody = JSON.parse(rawText) as Record<string, unknown>;
        } catch {
          parsedBody = null;
        }
      }

      if (!res.ok) {
        const errMsg =
          (parsedBody && (String(parsedBody.details || parsedBody.error || ''))) ||
          (looksLikeHtml
            ? `استجابة غير صالحة من الخادم (HTTP ${res.status})`
            : `HTTP ${res.status}`);
        throw new Error(errMsg);
      }

      if (!parsedBody || looksLikeHtml) {
        throw new Error('استجابة الخادم ليست بصيغة JSON (قد يكون الاتصال انقطع أو تأخر الرد). يرجى المحاولة مرة أخرى.');
      }

      const result = parsedBody as unknown as ShelfAnalysisResult;

      // If Gemini matched a different known shelf ID, switch to that shelf
      if (result.shelf_match_id && result.shelf_match_id !== shelf.id) {
        const matchedShelf = await getShelf(result.shelf_match_id);
        if (matchedShelf) {
          shelf = matchedShelf;
        }
      }

      // 5. Update photo in IndexedDB
      await updatePhotoAnalysis(photo.id, 'completed', result, undefined, shelf.id);

      // 6. Replace prior log entries for this photo (prevents duplicates on re-analysis)
      await deleteLogEntriesByPhotoId(photo.id);

      // 7. Generate Log Entries, Consumption History, and register products
      const todayStr = new Date().toISOString().slice(0, 10);
      const now = Date.now();
      const newEntries: LogEntry[] = [];
      const historyRecords: ConsumptionHistoryRecord[] = [];

      for (const item of result.products || []) {
        const existingProd = await findProductByName(item.standardized_name);
        const resolvedBarcode = item.barcode || existingProd?.barcode;
        const estimatedCap =
          shelf.fullCapacity ||
          photo.shelfCapacity ||
          existingProd?.defaultCapacity ||
          Math.max(1, item.units_present + item.missing_units);

        const logId = 'log_' + now + '_' + Math.random().toString(36).substring(2, 6);
        const entry: LogEntry = {
          id: logId,
          date: todayStr,
          timestamp: now,
          photoId: photo.id,
          sessionId: photo.sessionId,
          shelfId: shelf.id,
          shelfName: shelf.name,
          productName: item.standardized_name,
          unitsPresent: item.units_present,
          missingUnits: item.missing_units,
          confidence: item.confidence,
          boundingBox: item.bounding_box,
          isReviewed: false,
          barcode: resolvedBarcode,
        };
        newEntries.push(entry);

        historyRecords.push({
          id: 'hist_' + now + '_' + Math.random().toString(36).substring(2, 6),
          date: todayStr,
          timestamp: now,
          photoId: photo.id,
          shelfId: shelf.id,
          shelfName: shelf.name,
          productName: item.standardized_name,
          unitsPresent: item.units_present,
          missingUnits: item.missing_units,
          estimatedCapacity: estimatedCap,
          restockRatio: estimatedCap > 0 ? Math.min(1, item.missing_units / estimatedCap) : 0,
        });

        // Register product if not existing, or update lastSeen & defaultCapacity
        if (!existingProd) {
          const newProd: ProductRecord = {
            id: 'prod_' + now + '_' + Math.random().toString(36).substring(2, 6),
            standardizedName: item.standardized_name,
            barcode: resolvedBarcode,
            shelfId: shelf.id,
            defaultCapacity: estimatedCap,
            lastSeen: now,
          };
          await saveProduct(newProd);
        } else {
          existingProd.lastSeen = now;
          if (!existingProd.defaultCapacity && estimatedCap > 0) {
            existingProd.defaultCapacity = estimatedCap;
          }
          await saveProduct(existingProd);
        }

        // Add to shelf known products list
        if (!shelf.productNames.includes(item.standardized_name)) {
          shelf.productNames.push(item.standardized_name);
        }
      }

      await Promise.all([
        saveLogEntries(newEntries),
        saveConsumptionHistory(historyRecords),
      ]);

      // Auto-update shelf capacity if known (or learned from total units on golden/full reference)
      if (photo.shelfCapacity && !shelf.fullCapacity) {
        shelf.fullCapacity = photo.shelfCapacity;
      } else if (photo.isGoldenReference && !shelf.fullCapacity && result.products?.length) {
        const totalPresent = result.products.reduce((s, p) => s + p.units_present, 0);
        if (totalPresent > 0) {
          shelf.fullCapacity = totalPresent;
        }
      }
      shelf.updatedAt = Date.now();
      await saveShelf(shelf);

      return result;
    } catch (err: unknown) {
      console.error(`Failed to analyze photo ${photo.id}:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      await updatePhotoAnalysis(photo.id, 'error', undefined, msg);
      return null;
    }
  }

  /**
   * Process pending photos continuously (picks up new photos captured while running)
   * with configurable pacing ('safe' 4.5s, 'fast' 1.2s, or 'parallel' 2x concurrency)
   */
  public async processQueue(includeErrored = false): Promise<void> {
    if (this.isRunning) {
      this.rerunRequested = true;
      if (includeErrored) this.rerunIncludeErrored = true;
      return;
    }

    // Check online status
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.notify({
        isProcessing: false,
        message: 'الجهاز غير متصل بالإنترنت. سيتم التحليل تلقائياً عند الاتصال.',
      });
      setTimeout(() => {
        if (!this.isRunning) this.notify({ message: '' });
      }, 4000);
      return;
    }

    await recoverStuckAnalyzingPhotos();
    if (includeErrored) {
      await requeueErroredPhotos();
    }

    const initialPending = await getPendingPhotos();
    if (initialPending.length === 0) {
      this.notify({
        isProcessing: false,
        total: 0,
        current: 0,
        currentPhotoId: null,
        message: '',
      });
      return;
    }

    this.isRunning = true;
    this.rerunRequested = false;
    this.rerunIncludeErrored = false;
    const attemptedIds = new Set<string>();
    let processedCount = 0;
    let succeededCount = 0;
    let failedCount = 0;
    let knownTotal = initialPending.length;
    let interruptedOffline = false;

    this.notify({
      isProcessing: true,
      total: knownTotal,
      current: 0,
      message: `بدء تحليل الصور (${knownTotal})...`,
    });

    try {
      while (true) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          interruptedOffline = true;
          break;
        }

        if (this.rerunIncludeErrored) {
          this.rerunIncludeErrored = false;
          await requeueErroredPhotos();
        }
        this.rerunRequested = false;

        const settings = await getSettings();
        const paceMode = settings.analysisPaceMode || 'fast';
        const batchSize = paceMode === 'parallel' ? 2 : 1;
        const minSpacingMs = paceMode === 'safe' ? 4500 : paceMode === 'fast' ? 1000 : 500;

        const remaining = (await getPendingPhotos()).filter((p) => !attemptedIds.has(p.id));
        if (remaining.length === 0) {
          if (this.rerunRequested) {
            continue;
          }
          break;
        }

        knownTotal = Math.max(knownTotal, processedCount + remaining.length);
        const batch = remaining.slice(0, batchSize);
        batch.forEach((p) => attemptedIds.add(p.id));

        const displayIndex = Math.min(knownTotal, processedCount + batch.length);
        this.notify({
          isProcessing: true,
          total: knownTotal,
          current: displayIndex,
          currentPhotoId: batch[0].id,
          message:
            batch.length > 1
              ? `جاري تحليل ${processedCount + 1}-${displayIndex} من ${knownTotal}...`
              : `جاري تحليل ${displayIndex} من ${knownTotal}...`,
        });

        const reqStart = Date.now();
        const batchResults = await Promise.all(batch.map((photo) => this.analyzeSinglePhoto(photo)));
        for (const res of batchResults) {
          if (res) succeededCount++;
          else failedCount++;
        }
        processedCount += batch.length;
        this.notifyQueueChanged();

        // Check if more pending remain before sleeping
        const nextRemaining = (await getPendingPhotos()).filter((p) => !attemptedIds.has(p.id));
        if (nextRemaining.length > 0) {
          const remainingDelay = Math.max(0, minSpacingMs - (Date.now() - reqStart));
          if (remainingDelay > 0) {
            await new Promise((resolve) => setTimeout(resolve, remainingDelay));
          }
        }
      }
    } finally {
      this.isRunning = false;
    }

    const finalMessage = interruptedOffline
      ? `تم إيقاف التحليل مؤقتاً لفقدان الاتصال (${succeededCount}/${knownTotal})`
      : failedCount > 0 && succeededCount === 0
      ? `تعذر تحليل ${failedCount} صورة. اضغط "إعادة تحليل الصور المتعثرة" للمحاولة.`
      : failedCount > 0
      ? `تم تحليل ${succeededCount} صورة بنجاح وتعذر تحليل ${failedCount} صورة.`
      : 'تم إكمال تحليل جميع الصور بنجاح!';

    this.notify({
      isProcessing: false,
      total: 0,
      current: 0,
      currentPhotoId: null,
      message: finalMessage,
    });

    setTimeout(() => {
      if (!this.isRunning) {
        this.notify({ message: '' });
      }
    }, 4500);
  }
}

export const analysisQueue = new AnalysisQueueService();
