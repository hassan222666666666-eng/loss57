import {
  AppSettings,
  DEFAULT_SETTINGS,
  PhotoRecord,
  RestockSession,
  ShelfRecord,
  ProductRecord,
  LogEntry,
  DailyPickItem,
  DailyPickGroup,
  ShelfAnalysisResult,
  ShelfCorrection,
  ConsumptionHistoryRecord,
} from '../types';
import { generateSessionName } from '../utils/imageUtils';

const DB_NAME = 'rofoof_supermarket_db';
const DB_VERSION = 2;

let dbInstance: IDBDatabase | null = null;

export async function initDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Photos Store
      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', { keyPath: 'id' });
        photoStore.createIndex('sessionId', 'sessionId', { unique: false });
        photoStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Sessions Store
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessionStore.createIndex('startTime', 'startTime', { unique: false });
        sessionStore.createIndex('status', 'status', { unique: false });
      }

      // Settings Store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // Stage 2: Shelves Store (Learning Engine & Golden References)
      if (!db.objectStoreNames.contains('shelves')) {
        const shelfStore = db.createObjectStore('shelves', { keyPath: 'id' });
        shelfStore.createIndex('name', 'name', { unique: false });
        shelfStore.createIndex('aisle', 'aisle', { unique: false });
      }

      // Stage 2: Products Store (Standardized Names & Barcodes)
      if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', { keyPath: 'id' });
        productStore.createIndex('standardizedName', 'standardizedName', { unique: false });
        productStore.createIndex('barcode', 'barcode', { unique: false });
      }

      // Stage 2: Log Entries Store
      if (!db.objectStoreNames.contains('log_entries')) {
        const logStore = db.createObjectStore('log_entries', { keyPath: 'id' });
        logStore.createIndex('date', 'date', { unique: false });
        logStore.createIndex('photoId', 'photoId', { unique: false });
        logStore.createIndex('productName', 'productName', { unique: false });
        logStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Stage 2: Consumption History Store
      if (!db.objectStoreNames.contains('consumption_history')) {
        const historyStore = db.createObjectStore('consumption_history', { keyPath: 'id' });
        historyStore.createIndex('date', 'date', { unique: false });
        historyStore.createIndex('productName', 'productName', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to open IndexedDB'));
    };
  });
}

/**
 * Request persistent storage from the browser (protects data from eviction on Android)
 */
export async function requestStoragePersistence(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (isPersisted) return true;
      const granted = await navigator.storage.persist();
      return granted;
    } catch {
      return false;
    }
  }
  return false;
}

// ----------------- PHOTOS -----------------

export async function savePhoto(photo: PhotoRecord): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['photos', 'sessions'], 'readwrite');
    const photoStore = tx.objectStore('photos');
    const sessionStore = tx.objectStore('sessions');

    photoStore.put(photo);

    // Update photo count in session
    const getSessionReq = sessionStore.get(photo.sessionId);
    getSessionReq.onsuccess = () => {
      const session = getSessionReq.result as RestockSession | undefined;
      if (session) {
        session.photoCount = (session.photoCount || 0) + 1;
        sessionStore.put(session);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPhotosBySession(sessionId: string): Promise<PhotoRecord[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const index = store.index('sessionId');
    const request = index.getAll(sessionId);

    request.onsuccess = () => {
      const records = (request.result as PhotoRecord[]) || [];
      // Sort newest first
      records.sort((a, b) => b.timestamp - a.timestamp);
      resolve(records);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getAllPhotos(): Promise<PhotoRecord[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const request = store.getAll();

    request.onsuccess = () => {
      const records = (request.result as PhotoRecord[]) || [];
      records.sort((a, b) => b.timestamp - a.timestamp);
      resolve(records);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getPhotoById(id: string): Promise<PhotoRecord | null> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('photos', 'readonly');
    const store = tx.objectStore('photos');
    const request = store.get(id);
    request.onsuccess = () => resolve((request.result as PhotoRecord) || null);
    request.onerror = () => resolve(null);
  });
}

export async function updatePhoto(photo: PhotoRecord): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    const request = store.put(photo);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deletePhoto(id: string, sessionId?: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['photos', 'sessions'], 'readwrite');
    const photoStore = tx.objectStore('photos');
    const sessionStore = tx.objectStore('sessions');

    photoStore.delete(id);

    if (sessionId) {
      const getSessionReq = sessionStore.get(sessionId);
      getSessionReq.onsuccess = () => {
        const session = getSessionReq.result as RestockSession | undefined;
        if (session && session.photoCount > 0) {
          session.photoCount = Math.max(0, session.photoCount - 1);
          sessionStore.put(session);
        }
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteMultiplePhotos(ids: string[], sessionId?: string): Promise<void> {
  if (ids.length === 0) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['photos', 'sessions'], 'readwrite');
    const photoStore = tx.objectStore('photos');
    const sessionStore = tx.objectStore('sessions');

    ids.forEach((id) => photoStore.delete(id));

    if (sessionId) {
      const getSessionReq = sessionStore.get(sessionId);
      getSessionReq.onsuccess = () => {
        const session = getSessionReq.result as RestockSession | undefined;
        if (session) {
          session.photoCount = Math.max(0, (session.photoCount || 0) - ids.length);
          sessionStore.put(session);
        }
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['photos', 'sessions'], 'readwrite');
    const photoStore = tx.objectStore('photos');
    const sessionStore = tx.objectStore('sessions');

    // Delete session entry
    sessionStore.delete(sessionId);

    // Delete all photos belonging to this session
    const photoIndex = photoStore.index('sessionId');
    const req = photoIndex.getAllKeys(sessionId);
    req.onsuccess = () => {
      const keys = req.result;
      keys.forEach((key) => photoStore.delete(key));
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ----------------- SESSIONS -----------------

export async function createSession(name?: string): Promise<RestockSession> {
  const db = await initDB();
  const newSession: RestockSession = {
    id: 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    name: name || generateSessionName(),
    startTime: Date.now(),
    photoCount: 0,
    status: 'active',
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const request = store.put(newSession);

    request.onsuccess = () => resolve(newSession);
    request.onerror = () => reject(request.error);
  });
}

export async function getActiveSession(): Promise<RestockSession> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const request = store.getAll();

    request.onsuccess = async () => {
      const sessions = (request.result as RestockSession[]) || [];
      const active = sessions.find((s) => s.status === 'active');
      if (active) {
        resolve(active);
      } else {
        // Create a new default active session if none exists
        try {
          const fresh = await createSession();
          resolve(fresh);
        } catch (err) {
          reject(err);
        }
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getAllSessions(): Promise<RestockSession[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const request = store.getAll();

    request.onsuccess = () => {
      const sessions = (request.result as RestockSession[]) || [];
      sessions.sort((a, b) => b.startTime - a.startTime);
      resolve(sessions);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function closeSession(id: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const session = getReq.result as RestockSession | undefined;
      if (session) {
        session.status = 'completed';
        session.endTime = Date.now();
        store.put(session);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ----------------- SETTINGS -----------------

export async function getSettings(): Promise<AppSettings> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const request = store.get('app_settings');

    request.onsuccess = () => {
      if (request.result && request.result.value) {
        resolve({ ...DEFAULT_SETTINGS, ...request.result.value });
      } else {
        resolve({ ...DEFAULT_SETTINGS });
      }
    };
    request.onerror = () => resolve({ ...DEFAULT_SETTINGS });
  });
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const updated: AppSettings = { ...current, ...partial };
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const request = store.put({ key: 'app_settings', value: updated });

    request.onsuccess = () => resolve(updated);
    request.onerror = () => reject(request.error);
  });
}

// ----------------- BACKUP & CLEAR -----------------

export async function clearAllData(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const storeNames = ['photos', 'sessions', 'settings'];
    if (db.objectStoreNames.contains('shelves')) storeNames.push('shelves');
    if (db.objectStoreNames.contains('products')) storeNames.push('products');
    if (db.objectStoreNames.contains('log_entries')) storeNames.push('log_entries');
    if (db.objectStoreNames.contains('consumption_history')) storeNames.push('consumption_history');

    const tx = db.transaction(storeNames, 'readwrite');
    storeNames.forEach((s) => tx.objectStore(s).clear());

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportAllData(): Promise<string> {
  const [sessions, photos, settings, shelves, products, logEntries, consumptionHistory] = await Promise.all([
    getAllSessions(),
    getAllPhotos(),
    getSettings(),
    getAllShelves(),
    getAllProducts(),
    getAllLogEntries(),
    getAllConsumptionHistory(),
  ]);

  const exportPayload = {
    app: 'Rofoof Shelf Restock PWA',
    version: '2.0.0',
    exportDate: new Date().toISOString(),
    settings,
    sessions,
    shelves,
    products,
    logEntries,
    consumptionHistory,
    photosMeta: photos.map((p) => ({
      id: p.id,
      sessionId: p.sessionId,
      timestamp: p.timestamp,
      width: p.width,
      height: p.height,
      shelfCapacity: p.shelfCapacity,
      isGoldenReference: p.isGoldenReference,
      notes: p.notes,
      aisle: p.aisle,
      shelfNumber: p.shelfNumber,
      analysisStatus: p.analysisStatus,
      analysisResult: p.analysisResult,
    })),
    totalPhotos: photos.length,
    totalSessions: sessions.length,
  };

  return JSON.stringify(exportPayload, null, 2);
}

// ----------------- STAGE 2: SHELVES & LEARNING ENGINE -----------------

export async function saveShelf(shelf: ShelfRecord): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('shelves', 'readwrite');
    const store = tx.objectStore('shelves');
    const request = store.put(shelf);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getShelf(id: string): Promise<ShelfRecord | null> {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('shelves', 'readonly');
    const store = tx.objectStore('shelves');
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}

export async function getAllShelves(): Promise<ShelfRecord[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('shelves')) return resolve([]);
    const tx = db.transaction('shelves', 'readonly');
    const store = tx.objectStore('shelves');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
}

export async function findOrCreateShelf(aisle?: string, shelfNumber?: string): Promise<ShelfRecord> {
  const all = await getAllShelves();
  const cleanAisle = (aisle || 'ممر عام').trim();
  const cleanNumber = (shelfNumber || '1').trim();
  const name = `${cleanAisle} - رف ${cleanNumber}`;

  const existing = all.find(
    (s) =>
      (s.aisle?.trim() === cleanAisle && s.shelfNumber?.trim() === cleanNumber) ||
      s.name.trim() === name
  );

  if (existing) return existing;

  const newShelf: ShelfRecord = {
    id: 'shelf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    name,
    aisle: cleanAisle,
    shelfNumber: cleanNumber,
    goldenPhotoId: null,
    goldenPhotoDataUrl: null,
    fullCapacity: null,
    productNames: [],
    recentCorrections: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await saveShelf(newShelf);
  return newShelf;
}

export async function saveGoldenReference(
  shelfId: string,
  photoId: string,
  dataUrl: string,
  capacity?: number | null
): Promise<void> {
  const shelf = await getShelf(shelfId);
  if (!shelf) return;

  shelf.goldenPhotoId = photoId;
  shelf.goldenPhotoDataUrl = dataUrl;
  if (capacity) {
    shelf.fullCapacity = capacity;
  }
  shelf.updatedAt = Date.now();
  await saveShelf(shelf);
}

export async function getGoldenReferenceForShelf(
  shelfId: string
): Promise<{ photoId: string; dataUrl: string } | null> {
  const shelf = await getShelf(shelfId);
  if (!shelf || !shelf.goldenPhotoDataUrl) return null;
  return {
    photoId: shelf.goldenPhotoId || '',
    dataUrl: shelf.goldenPhotoDataUrl,
  };
}

export async function addShelfCorrection(shelfId: string, correction: ShelfCorrection): Promise<void> {
  const shelf = await getShelf(shelfId);
  if (!shelf) return;

  // Keep 3 most recent corrections for few-shot prompt
  const updatedCorrections = [correction, ...(shelf.recentCorrections || [])].slice(0, 3);
  shelf.recentCorrections = updatedCorrections;

  // Add product name if not already listed
  if (correction.productName && !shelf.productNames.includes(correction.productName)) {
    shelf.productNames.push(correction.productName);
  }

  shelf.updatedAt = Date.now();
  await saveShelf(shelf);
}

export async function updateShelfCapacity(shelfId: string, capacity: number | null): Promise<void> {
  if (!shelfId || !capacity || capacity <= 0) return;
  const shelf = await getShelf(shelfId);
  if (!shelf) return;
  shelf.fullCapacity = capacity;
  shelf.updatedAt = Date.now();
  await saveShelf(shelf);
}

// ----------------- STAGE 2: PRODUCTS STORE -----------------

export async function saveProduct(product: ProductRecord): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite');
    const store = tx.objectStore('products');
    const request = store.put(product);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getAllProducts(): Promise<ProductRecord[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('products')) return resolve([]);
    const tx = db.transaction('products', 'readonly');
    const store = tx.objectStore('products');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });
}

export async function findProductByName(name: string): Promise<ProductRecord | null> {
  const products = await getAllProducts();
  const trimmed = name.trim().toLowerCase();
  return products.find((p) => p.standardizedName.trim().toLowerCase() === trimmed) || null;
}

// ----------------- STAGE 2: LOG ENTRIES & DEDUPLICATION -----------------

export async function saveLogEntries(entries: LogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('log_entries', 'readwrite');
    const store = tx.objectStore('log_entries');
    entries.forEach((entry) => store.put(entry));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllLogEntries(): Promise<LogEntry[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('log_entries')) return resolve([]);
    const tx = db.transaction('log_entries', 'readonly');
    const store = tx.objectStore('log_entries');
    const request = store.getAll();
    request.onsuccess = () => {
      const list = (request.result as LogEntry[]) || [];
      list.sort((a, b) => b.timestamp - a.timestamp);
      resolve(list);
    };
    request.onerror = () => resolve([]);
  });
}

export async function getLogEntriesByDate(dateStr: string): Promise<LogEntry[]> {
  const all = await getAllLogEntries();
  return all.filter((e) => e.date === dateStr);
}

export async function updateLogEntry(entry: LogEntry): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('log_entries', 'readwrite');
    const store = tx.objectStore('log_entries');
    const request = store.put(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteLogEntry(id: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('log_entries', 'readwrite');
    const store = tx.objectStore('log_entries');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteLogEntriesByPhotoId(photoId: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('log_entries')) return resolve();
    const tx = db.transaction('log_entries', 'readwrite');
    const store = tx.objectStore('log_entries');
    const index = store.index('photoId');
    const req = index.getAllKeys(photoId);
    req.onsuccess = () => {
      const keys = req.result || [];
      keys.forEach((key) => store.delete(key));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteLogEntriesByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('log_entries')) return resolve();
    const tx = db.transaction('log_entries', 'readwrite');
    const store = tx.objectStore('log_entries');
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAllLogEntriesByDate(
  dateStr = new Date().toISOString().slice(0, 10)
): Promise<void> {
  const entries = await getLogEntriesByDate(dateStr);
  await deleteLogEntriesByIds(entries.map((e) => e.id));
}

export async function deleteAllLogEntries(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('log_entries')) return resolve();
    const tx = db.transaction('log_entries', 'readwrite');
    tx.objectStore('log_entries').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateLogEntriesFulfillment(
  ids: string[],
  updates: { isCollected?: boolean; isPlaced?: boolean }
): Promise<void> {
  if (ids.length === 0) return;
  const db = await initDB();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('log_entries')) return resolve();
    const tx = db.transaction('log_entries', 'readwrite');
    const store = tx.objectStore('log_entries');

    ids.forEach((id) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const entry = req.result as LogEntry | undefined;
        if (!entry) return;

        let nextCollected =
          updates.isCollected !== undefined ? updates.isCollected : Boolean(entry.isCollected);
        let nextPlaced =
          updates.isPlaced !== undefined ? updates.isPlaced : Boolean(entry.isPlaced);

        // Enforce logical progression: placed implies collected; uncollecting resets placed
        if (updates.isPlaced === true) {
          nextCollected = true;
        }
        if (updates.isCollected === false) {
          nextPlaced = false;
        }

        entry.isCollected = nextCollected;
        entry.collectedAt = nextCollected ? entry.collectedAt || now : undefined;
        entry.isPlaced = nextPlaced;
        entry.placedAt = nextPlaced ? entry.placedAt || now : undefined;

        store.put(entry);
      };
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAllSessionsAndLogs(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const stores = ['sessions', 'photos'];
    if (db.objectStoreNames.contains('log_entries')) stores.push('log_entries');
    const tx = db.transaction(stores, 'readwrite');
    stores.forEach((name) => tx.objectStore(name).clear());
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ----------------- STAGE 2: CONSUMPTION HISTORY -----------------

export async function saveConsumptionHistory(records: ConsumptionHistoryRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('consumption_history')) return resolve();
    const tx = db.transaction('consumption_history', 'readwrite');
    const store = tx.objectStore('consumption_history');
    records.forEach((rec) => store.put(rec));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllConsumptionHistory(): Promise<ConsumptionHistoryRecord[]> {
  const db = await initDB();
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('consumption_history')) return resolve([]);
    const tx = db.transaction('consumption_history', 'readonly');
    const store = tx.objectStore('consumption_history');
    const request = store.getAll();
    request.onsuccess = () => {
      const list = (request.result as ConsumptionHistoryRecord[]) || [];
      list.sort((a, b) => b.timestamp - a.timestamp);
      resolve(list);
    };
    request.onerror = () => resolve([]);
  });
}

export async function getConsumptionHistoryByDate(dateStr: string): Promise<ConsumptionHistoryRecord[]> {
  const all = await getAllConsumptionHistory();
  return all.filter((r) => r.date === dateStr);
}

function buildMergedPickItems(entries: LogEntry[], dateStr: string): DailyPickItem[] {
  const map: Record<string, DailyPickItem> = {};

  for (const entry of entries) {
    const key = entry.productName.trim();
    if (!map[key]) {
      map[key] = {
        date: dateStr,
        productName: key,
        totalMissingUnits: 0,
        sourcePhotoIds: [],
        shelfNames: [],
        barcode: entry.barcode,
        minConfidence: entry.confidence,
        needsReview: entry.confidence < 0.7 && !entry.isReviewed,
        isCollected: true,
        isPlaced: true,
        entries: [],
      };
    }

    map[key].totalMissingUnits += entry.missingUnits;
    if (!map[key].sourcePhotoIds.includes(entry.photoId)) {
      map[key].sourcePhotoIds.push(entry.photoId);
    }
    if (entry.shelfName && !map[key].shelfNames.includes(entry.shelfName)) {
      map[key].shelfNames.push(entry.shelfName);
    }
    if (!map[key].barcode && entry.barcode) {
      map[key].barcode = entry.barcode;
    }
    if (entry.confidence < map[key].minConfidence) {
      map[key].minConfidence = entry.confidence;
    }
    if (entry.confidence < 0.7 && !entry.isReviewed) {
      map[key].needsReview = true;
    }
    if (!entry.isCollected) {
      map[key].isCollected = false;
    }
    if (!entry.isPlaced) {
      map[key].isPlaced = false;
    }
    map[key].entries.push(entry);
  }

  const result = Object.values(map).filter(
    (item) => item.totalMissingUnits > 0 || item.needsReview
  );
  // Active pending/collected items first, completed placed items below, then highest missing first
  result.sort((a, b) => {
    if (a.isPlaced !== b.isPlaced) return a.isPlaced ? 1 : -1;
    return b.totalMissingUnits - a.totalMissingUnits;
  });
  return result;
}

export function formatArabicDateGroupLabel(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return dateStr;

  const targetDate = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (todayMidnight.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  try {
    const weekday = new Intl.DateTimeFormat('ar-IQ', { weekday: 'long' }).format(targetDate);
    if (diffDays === 0) return `اليوم - ${weekday}`;
    if (diffDays === 1) return `أمس - ${weekday}`;
    const fullDate = new Intl.DateTimeFormat('ar-IQ', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(targetDate);
    return fullDate;
  } catch {
    if (diffDays === 0) return `اليوم (${dateStr})`;
    if (diffDays === 1) return `أمس (${dateStr})`;
    return dateStr;
  }
}

/**
 * Smart Deduplication:
 * Merges identical products in the daily pick list across all shelf photos
 * for the requested date (defaults to today YYYY-MM-DD), summing missing_units.
 */
export async function getDailyMergedPickList(
  dateStr = new Date().toISOString().slice(0, 10)
): Promise<DailyPickItem[]> {
  const entries = await getLogEntriesByDate(dateStr);
  return buildMergedPickItems(entries, dateStr);
}

/**
 * Stage 3: Grouped Pick List by Date (descending: اليوم، أمس، ...)
 * Loads entirely offline from IndexedDB with consolidated products & two-step status.
 */
export async function getGroupedPickListByDate(): Promise<DailyPickGroup[]> {
  const allEntries = await getAllLogEntries();
  const byDate: Record<string, LogEntry[]> = {};

  for (const entry of allEntries) {
    const d = entry.date || new Date(entry.timestamp).toISOString().slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(entry);
  }

  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const groups: DailyPickGroup[] = [];

  for (const dateStr of sortedDates) {
    const items = buildMergedPickItems(byDate[dateStr], dateStr);
    if (items.length === 0) continue;

    const totalMissingUnits = items.reduce((sum, item) => sum + item.totalMissingUnits, 0);
    const collectedCount = items.filter((item) => item.isCollected && !item.isPlaced).length;
    const placedCount = items.filter((item) => item.isPlaced).length;

    groups.push({
      date: dateStr,
      label: formatArabicDateGroupLabel(dateStr),
      totalMissingUnits,
      collectedCount,
      placedCount,
      items,
    });
  }

  return groups;
}

// ----------------- STAGE 2: PENDING PHOTOS & QUEUE -----------------

export async function getPendingPhotos(): Promise<PhotoRecord[]> {
  const all = await getAllPhotos();
  return all.filter((p) => p.analysisStatus === 'pending' || !p.analysisStatus);
}

export async function getErroredPhotos(): Promise<PhotoRecord[]> {
  const all = await getAllPhotos();
  return all.filter((p) => p.analysisStatus === 'error');
}

export async function requeueErroredPhotos(): Promise<number> {
  const errored = await getErroredPhotos();
  if (errored.length === 0) return 0;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    errored.forEach((p) => {
      store.put({
        ...p,
        analysisStatus: 'pending',
        analysisError: undefined,
      });
    });
    tx.oncomplete = () => resolve(errored.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function recoverStuckAnalyzingPhotos(): Promise<number> {
  const all = await getAllPhotos();
  const stuck = all.filter((p) => p.analysisStatus === 'analyzing');
  if (stuck.length === 0) return 0;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    stuck.forEach((p) => {
      store.put({
        ...p,
        analysisStatus: 'pending',
      });
    });
    tx.oncomplete = () => resolve(stuck.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function updatePhotoAnalysis(
  photoId: string,
  status: PhotoRecord['analysisStatus'],
  result?: ShelfAnalysisResult,
  error?: string,
  shelfMatchId?: string | null
): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    const req = store.get(photoId);

    req.onsuccess = () => {
      const photo = req.result as PhotoRecord | undefined;
      if (photo) {
        photo.analysisStatus = status;
        if (result !== undefined) {
          photo.analysisResult = result;
        }
        if (error !== undefined) {
          photo.analysisError = error;
        } else if (status !== 'error') {
          photo.analysisError = undefined;
        }
        if (shelfMatchId !== undefined) {
          photo.shelfMatchId = shelfMatchId;
        }
        store.put(photo);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

