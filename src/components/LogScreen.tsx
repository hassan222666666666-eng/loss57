import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ClipboardList,
  Calendar,
  Clock,
  Sparkles,
  ChevronLeft,
  ChevronDown,
  Trash2,
  AlertTriangle,
  Award,
  Edit3,
  CheckCircle2,
  Package,
  Share2,
  RefreshCw,
  Barcode,
  Image as ImageIcon,
  Camera,
  ShoppingCart,
  PackageCheck,
  WifiOff,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  PhotoRecord,
  RestockSession,
  DailyPickItem,
  DailyPickGroup,
  LogEntry,
} from '../types';
import {
  getAllSessions,
  getPhotosBySession,
  getPhotoById,
  deletePhoto,
  deleteLogEntriesByPhotoId,
  deleteLogEntriesByIds,
  deleteAllLogEntries,
  deleteAllLogEntriesByDate,
  deleteAllSessionsAndLogs,
  getAllLogEntries,
  updatePhoto,
  deleteSession,
  getGroupedPickListByDate,
  updateLogEntriesFulfillment,
  getPendingPhotos,
  getErroredPhotos,
} from '../services/db';
import { analysisQueue, QueueProgressState } from '../services/analysisQueue';
import { formatArabicDate, formatPhotoCountLabel } from '../utils/imageUtils';
import { PhotoDetailEditorModal } from './PhotoDetailEditorModal';
import { QuickEditAnalysisModal } from './QuickEditAnalysisModal';
import { SourceShelfPhotoModal } from './SourceShelfPhotoModal';

interface LogScreenProps {
  onSelectPhotoPreview?: (photo: PhotoRecord) => void;
}

type FulfillmentFilter = 'all' | 'pending' | 'collected' | 'placed';

export const LogScreen: React.FC<LogScreenProps> = () => {
  // Tab: 'pick_list' (Grouped Pick List & Two-Step Fulfillment) vs 'sessions' (Session History)
  const [activeSubTab, setActiveSubTab] = useState<'pick_list' | 'sessions'>('pick_list');

  // Offline / Online awareness for warehouse work
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Date-grouped pick list state (loaded 100% offline from IndexedDB)
  const [groupedPickLists, setGroupedPickLists] = useState<DailyPickGroup[]>([]);
  const [pickListLoading, setPickListLoading] = useState(true);
  const [fulfillmentFilter, setFulfillmentFilter] = useState<FulfillmentFilter>('all');
  const [pendingPhotosCount, setPendingPhotosCount] = useState<number>(0);
  const [erroredPhotosCount, setErroredPhotosCount] = useState<number>(0);
  const [totalAnalyzedEntriesCount, setTotalAnalyzedEntriesCount] = useState<number>(0);
  const [queueState, setQueueState] = useState<QueueProgressState>(analysisQueue.getState());

  // Modals & drawers
  const [editingLogEntry, setEditingLogEntry] = useState<LogEntry | null>(null);
  const [expandedPickKey, setExpandedPickKey] = useState<string | null>(null);
  const [viewingSourceKey, setViewingSourceKey] = useState<{
    date: string;
    productName: string;
  } | null>(null);
  const [sourcePhotosCache, setSourcePhotosCache] = useState<Record<string, PhotoRecord>>({});
  const [copySuccess, setCopySuccess] = useState(false);

  // Sessions state
  const [sessions, setSessions] = useState<RestockSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [sessionPhotos, setSessionPhotos] = useState<Record<string, PhotoRecord[]>>({});
  const [editingPhoto, setEditingPhoto] = useState<PhotoRecord | null>(null);

  // Deletion confirmations
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [confirmDeleteAllPickList, setConfirmDeleteAllPickList] = useState(false);
  const [confirmDeleteAllSessions, setConfirmDeleteAllSessions] = useState(false);

  // Listen for network connectivity changes
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Load Grouped Pick Lists, Pending & Errored counts offline from IndexedDB
  const loadPickList = useCallback(async () => {
    try {
      const [groups, pending, errored, allEntries] = await Promise.all([
        getGroupedPickListByDate(),
        getPendingPhotos(),
        getErroredPhotos(),
        getAllLogEntries(),
      ]);
      setGroupedPickLists(groups);
      setPendingPhotosCount(pending.length);
      setErroredPhotosCount(errored.length);
      setTotalAnalyzedEntriesCount(allEntries.length);
    } catch (err) {
      console.error('Failed to load grouped pick list:', err);
    } finally {
      setPickListLoading(false);
    }
  }, []);

  // Refresh photos for a specific session
  const refreshSessionPhotos = useCallback(async (sessionId: string) => {
    try {
      const photos = await getPhotosBySession(sessionId);
      setSessionPhotos((prev) => ({ ...prev, [sessionId]: photos }));
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, photoCount: photos.length } : s))
      );
    } catch (err) {
      console.error('Failed to refresh session photos:', err);
    }
  }, []);

  // Subscribe to analysis queue updates
  useEffect(() => {
    const unsubscribe = analysisQueue.subscribe((state) => {
      setQueueState(state);
      loadPickList();
      if (expandedSessionId) {
        refreshSessionPhotos(expandedSessionId);
      }
    });
    return unsubscribe;
  }, [expandedSessionId, loadPickList, refreshSessionPhotos]);

  // Load all sessions offline from IndexedDB
  const loadSessions = useCallback(async () => {
    try {
      const list = await getAllSessions();
      setSessions(list);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPickList();
    loadSessions();
  }, [loadPickList, loadSessions]);

  // Preload visible source photos into memory cache for instant offline modal display
  useEffect(() => {
    const photoIdsToPrefetch: string[] = [];
    for (const group of groupedPickLists) {
      for (const item of group.items) {
        for (const pid of item.sourcePhotoIds) {
          if (!sourcePhotosCache[pid] && !photoIdsToPrefetch.includes(pid)) {
            photoIdsToPrefetch.push(pid);
          }
          if (photoIdsToPrefetch.length >= 12) break;
        }
        if (photoIdsToPrefetch.length >= 12) break;
      }
      if (photoIdsToPrefetch.length >= 12) break;
    }

    if (photoIdsToPrefetch.length > 0) {
      Promise.all(photoIdsToPrefetch.map((id) => getPhotoById(id)))
        .then((loaded) => {
          setSourcePhotosCache((prev) => {
            const next = { ...prev };
            loaded.forEach((p) => {
              if (p) next[p.id] = p;
            });
            return next;
          });
        })
        .catch(() => {});
    }
  }, [groupedPickLists, sourcePhotosCache]);

  // Resolve active item for SourceShelfPhotoModal reactively so checkboxes sync immediately
  const viewingSourceItem = useMemo(() => {
    if (!viewingSourceKey) return null;
    const grp = groupedPickLists.find((g) => g.date === viewingSourceKey.date);
    return grp?.items.find((i) => i.productName === viewingSourceKey.productName) || null;
  }, [viewingSourceKey, groupedPickLists]);

  // Two-Step Fulfillment Handlers (persisted immediately to IndexedDB)
  const handleToggleCollected = async (item: DailyPickItem) => {
    const ids = item.entries.map((e) => e.id);
    const nextCollected = !item.isCollected;
    await updateLogEntriesFulfillment(ids, { isCollected: nextCollected });
    await loadPickList();
  };

  const handleTogglePlaced = async (item: DailyPickItem) => {
    const ids = item.entries.map((e) => e.id);
    const nextPlaced = !item.isPlaced;
    await updateLogEntriesFulfillment(ids, { isPlaced: nextPlaced });
    await loadPickList();
  };

  // Trigger Queue Processing
  const handleRunQueue = (includeErrors = false) => {
    analysisQueue.processQueue(includeErrors);
  };

  // Toggle source photos & bounding boxes drawer inside card
  const handleTogglePickSources = async (item: DailyPickItem) => {
    const key = `${item.date}__${item.productName}`;
    if (expandedPickKey === key) {
      setExpandedPickKey(null);
      return;
    }
    setExpandedPickKey(key);
    const missingIds = item.sourcePhotoIds.filter((id) => !sourcePhotosCache[id]);
    if (missingIds.length > 0) {
      const loaded = await Promise.all(missingIds.map((id) => getPhotoById(id)));
      setSourcePhotosCache((prev) => {
        const next = { ...prev };
        loaded.forEach((photo) => {
          if (photo) next[photo.id] = photo;
        });
        return next;
      });
    }
  };

  // Expand / collapse a session and load its photos
  const toggleExpand = async (sessionId: string) => {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      return;
    }

    setExpandedSessionId(sessionId);
    try {
      const photos = await getPhotosBySession(sessionId);
      setSessionPhotos((prev) => ({ ...prev, [sessionId]: photos }));
    } catch (err) {
      console.error('Failed to load photos for session:', err);
    }
  };

  // Delete single photo handler (inside modal)
  const handleDeletePhoto = async (photoId: string) => {
    if (!editingPhoto) return;
    const targetSessionId = editingPhoto.sessionId;
    await deletePhoto(photoId, targetSessionId);
    await deleteLogEntriesByPhotoId(photoId);
    setEditingPhoto(null);
    await refreshSessionPhotos(targetSessionId);
    await loadPickList();
  };

  // Update photo handler
  const handleUpdatePhoto = async (updated: PhotoRecord) => {
    await updatePhoto(updated);
    setEditingPhoto(null);
    await refreshSessionPhotos(updated.sessionId);
    await loadPickList();
  };

  // Delete single photo directly without opening editor
  const handleDeletePhotoDirect = async (photo: PhotoRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    await deletePhoto(photo.id, photo.sessionId);
    await deleteLogEntriesByPhotoId(photo.id);
    await refreshSessionPhotos(photo.sessionId);
    await loadPickList();
  };

  // Delete specific product item directly from Pick List
  const handleDeletePickItem = async (item: DailyPickItem) => {
    const ids = item.entries.map((e) => e.id);
    await deleteLogEntriesByIds(ids);
    await loadPickList();
  };

  // Delete a specific date group
  const handleDeleteDateGroup = async (dateStr: string) => {
    await deleteAllLogEntriesByDate(dateStr);
    await loadPickList();
  };

  // Delete all entries across all dates
  const handleDeleteAllPickList = async () => {
    await deleteAllLogEntries();
    setConfirmDeleteAllPickList(false);
    await loadPickList();
  };

  // Delete all sessions, photos, and log entries
  const handleDeleteAllSessions = async () => {
    setIsDeletingSession(true);
    try {
      await deleteAllSessionsAndLogs();
      setSessions([]);
      setSessionPhotos({});
      setExpandedSessionId(null);
      setConfirmDeleteAllSessions(false);
      await loadPickList();
    } catch (err) {
      console.error('Failed to delete all sessions:', err);
    } finally {
      setIsDeletingSession(false);
    }
  };

  // Delete entire session
  const handleDeleteEntireSession = async (sessionId: string) => {
    setIsDeletingSession(true);
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setConfirmDeleteSessionId(null);
      if (expandedSessionId === sessionId) {
        setExpandedSessionId(null);
      }
      await loadPickList();
    } catch (err) {
      console.error('Failed to delete session:', err);
    } finally {
      setIsDeletingSession(false);
    }
  };

  // Aggregate KPI totals across all dates
  const summaryStats = useMemo(() => {
    let totalItems = 0;
    let totalMissingUnits = 0;
    let remainingMissingUnits = 0;
    let pendingCount = 0;
    let collectedInCartCount = 0;
    let placedCount = 0;
    let reviewCount = 0;

    for (const group of groupedPickLists) {
      for (const item of group.items) {
        totalItems++;
        totalMissingUnits += item.totalMissingUnits;
        if (item.needsReview) reviewCount++;
        if (item.isPlaced) {
          placedCount++;
        } else if (item.isCollected) {
          collectedInCartCount++;
          remainingMissingUnits += item.totalMissingUnits;
        } else {
          pendingCount++;
          remainingMissingUnits += item.totalMissingUnits;
        }
      }
    }

    return {
      totalItems,
      totalMissingUnits,
      remainingMissingUnits,
      pendingCount,
      collectedInCartCount,
      placedCount,
      reviewCount,
    };
  }, [groupedPickLists]);

  // Filtered date groups according to fulfillment stage
  const filteredGroups = useMemo(() => {
    if (fulfillmentFilter === 'all') return groupedPickLists;
    return groupedPickLists
      .map((group) => {
        const items = group.items.filter((item) => {
          if (fulfillmentFilter === 'pending') return !item.isCollected && !item.isPlaced;
          if (fulfillmentFilter === 'collected') return item.isCollected && !item.isPlaced;
          if (fulfillmentFilter === 'placed') return item.isPlaced;
          return true;
        });
        return { ...group, items };
      })
      .filter((group) => group.items.length > 0);
  }, [groupedPickLists, fulfillmentFilter]);

  // Copy consolidated pick list as formatted text
  const handleCopyPickList = () => {
    if (groupedPickLists.length === 0) return;
    const lines: string[] = ['📋 سجل وقائمة تعبئة الأرفف - تطبيق رفوف'];
    for (const group of groupedPickLists) {
      lines.push(`\n📅 ${group.label} (${group.totalMissingUnits} قطعة):`);
      group.items.forEach((item, i) => {
        const statusLabel = item.isPlaced
          ? '✅ مرتب على الرف'
          : item.isCollected
          ? '🛒 في العربة'
          : '⏳ مطلوب';
        lines.push(
          `${i + 1}. ${item.productName}: ${item.totalMissingUnits} قطعة [${statusLabel}] (${item.shelfNames.join('، ')})`
        );
      });
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 3000);
    });
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-6 pb-28 space-y-5" dir="rtl">
      {/* Top Banner & Header */}
      <div className="px-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">
            سجل النواقص والتجهيز
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            مجمع حسب التاريخ · معاينة الرف بالصورة الأصلية · متابعة التجهيز على مرحلتين
          </p>
        </div>

        {/* Share / Copy & Delete All Buttons */}
        {activeSubTab === 'pick_list' &&
          (groupedPickLists.length > 0 || totalAnalyzedEntriesCount > 0) && (
            <div className="flex items-center gap-2 shrink-0">
              {groupedPickLists.length > 0 && (
                <button
                  type="button"
                  onClick={handleCopyPickList}
                  className="min-h-[44px] px-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-1.5 shadow-sm active:scale-95 transition whitespace-nowrap"
                >
                  {copySuccess ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Share2 className="w-4 h-4" />
                  )}
                  <span>{copySuccess ? 'تم النسخ!' : 'مشاركة القائمة'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmDeleteAllPickList((v) => !v)}
                title="حذف جميع سجلات النواقص"
                className="min-h-[44px] px-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 text-xs font-bold flex items-center gap-1.5 shadow-sm active:scale-95 transition whitespace-nowrap"
              >
                <Trash2 className="w-4 h-4" />
                <span>حذف الكل</span>
              </button>
            </div>
          )}
      </div>

      {/* Offline Mode Assurance Banner (shown only when offline in warehouse) */}
      {!isOnline && (
        <div className="p-3 rounded-[16px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 flex items-center gap-2.5 text-xs font-bold">
          <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            وضع عدم الاتصال بالمستودع · السجل وصور الأرفف الأصلية تعمل بالكامل من الذاكرة المحلية
          </span>
        </div>
      )}

      {/* Confirm Delete All Pick List Banner */}
      {activeSubTab === 'pick_list' && confirmDeleteAllPickList && (
        <div className="p-3.5 rounded-[20px] bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 flex items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>حذف جميع عناصر سجل النواقص نهائياً؟</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDeleteAllPickList}
              className="min-h-[44px] px-3.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold active:scale-95 transition"
            >
              نعم، احذف الكل
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteAllPickList(false)}
              className="min-h-[44px] px-3 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold border border-slate-200 dark:border-slate-700"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Sub-Tabs: Pick List vs Sessions */}
      <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-200/70 dark:bg-slate-800/80">
        <button
          type="button"
          onClick={() => setActiveSubTab('pick_list')}
          className={`flex-1 min-h-[46px] rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition whitespace-nowrap ${
            activeSubTab === 'pick_list'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <Package className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>قائمة النواقص والتجهيز</span>
          {summaryStats.totalItems > 0 && (
            <span className="tabular-nums text-[11px] font-black text-emerald-600 dark:text-emerald-400">
              ({summaryStats.totalItems})
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('sessions')}
          className={`flex-1 min-h-[46px] rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition whitespace-nowrap ${
            activeSubTab === 'sessions'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
          }`}
        >
          <Calendar className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>جولات وصور الأرفف</span>
          {sessions.length > 0 && (
            <span className="tabular-nums text-[11px] font-black text-slate-500 dark:text-slate-400">
              ({sessions.length})
            </span>
          )}
        </button>
      </div>

      {/* Queue Progress or Pending / Errored Alert Banner */}
      {queueState.isProcessing ? (
        <div className="p-3.5 rounded-[20px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold">
            <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
            <span>{queueState.message}</span>
          </div>
          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            جاري المعالجة...
          </span>
        </div>
      ) : pendingPhotosCount > 0 ? (
        <div className="p-3.5 rounded-[20px] bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>يوجد {pendingPhotosCount} صورة بانتظار التحليل</span>
          </div>
          <button
            type="button"
            onClick={() => handleRunQueue(false)}
            className="min-h-[44px] px-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>تحليل الآن</span>
          </button>
        </div>
      ) : erroredPhotosCount > 0 ? (
        <div className="p-3.5 rounded-[20px] bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>تعذر تحليل {erroredPhotosCount} صورة</span>
          </div>
          <button
            type="button"
            onClick={() => handleRunQueue(true)}
            className="min-h-[44px] px-3.5 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      ) : null}

      {/* ==================== TAB 1: GROUPED PICK LIST & FULFILLMENT ==================== */}
      {activeSubTab === 'pick_list' && (
        <div className="space-y-5">
          {/* Summary Progress & Fulfillment Metrics Card */}
          <div className="bg-white dark:bg-slate-900 rounded-[20px] p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 block">
                  القطع المتبقية لإعادة التعبئة
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {summaryStats.remainingMissingUnits}
                  </span>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    من أصل {summaryStats.totalMissingUnits} قطعة · {summaryStats.totalItems} صنف
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={loadPickList}
                title="تحديث السجل"
                aria-label="تحديث السجل"
                className="min-h-[44px] min-w-[44px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 transition shrink-0"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {/* Interactive Fulfillment Stage Filter Tabs */}
            {summaryStats.totalItems > 0 && (
              <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#F7F8FA] dark:bg-slate-800/80">
                {(
                  [
                    { key: 'all', label: `الكل (${summaryStats.totalItems})` },
                    { key: 'pending', label: `مطلوب (${summaryStats.pendingCount})` },
                    { key: 'collected', label: `في العربة (${summaryStats.collectedInCartCount})` },
                    { key: 'placed', label: `مرتب (${summaryStats.placedCount})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFulfillmentFilter(tab.key)}
                    className={`min-h-[40px] px-1.5 rounded-lg text-[11px] font-bold transition whitespace-nowrap truncate ${
                      fulfillmentFilter === tab.key
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Low-Confidence Review Summary Banner */}
          {summaryStats.reviewCount > 0 && (
            <div className="p-3.5 rounded-[20px] bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 flex items-center gap-2.5 text-xs font-bold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                يوجد {summaryStats.reviewCount} صنف بدقة أقل من 70% يحتاج مراجعة سريعة قبل الاعتماد النهائي.
              </span>
            </div>
          )}

          {/* Grouped Pick Lists */}
          {pickListLoading ? (
            <div className="py-12 text-center text-slate-400 text-sm font-semibold">
              جاري تحميل السجل من الذاكرة المحلية...
            </div>
          ) : groupedPickLists.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-[20px] p-8 text-center border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
              <div className="w-16 h-16 rounded-[20px] bg-emerald-50 dark:bg-emerald-950/60 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white">
                جميع الأرفف مكتملة التعبئة!
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
                {totalAnalyzedEntriesCount > 0
                  ? `تم تحليل ${totalAnalyzedEntriesCount} منتج وجميع صفوفها متقدمة وممتلئة (0 نقص). يمكنك استعراض الصور المحللة من تبويب "جولات وصور الأرفف".`
                  : 'لا توجد نواقص مسجلة حالياً. عند تصوير أو رفع صور أرفف تحتوي فراغات، ستظهر الأصناف مجمعة حسب التاريخ هنا تلقائياً.'}
              </p>
              {totalAnalyzedEntriesCount > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveSubTab('sessions')}
                  className="min-h-[44px] px-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Calendar className="w-4 h-4" />
                  <span>عرض الصور المحللة</span>
                </button>
              )}
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-[20px] p-8 text-center border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-2">
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                لا توجد أصناف ضمن هذا التصنيف حالياً
              </p>
              <button
                type="button"
                onClick={() => setFulfillmentFilter('all')}
                className="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold"
              >
                عرض جميع الأصناف
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {filteredGroups.map((group) => (
                <section key={group.date} className="space-y-3">
                  {/* Date Section Header */}
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2 text-sm font-extrabold text-slate-800 dark:text-slate-100">
                      <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>{group.label}</span>
                      <span className="text-xs font-semibold text-slate-400 tabular-nums">
                        · {group.items.length} صنف · {group.totalMissingUnits} قطعة
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteDateGroup(group.date)}
                      title={`حذف سجل ${group.label}`}
                      className="min-h-[36px] px-2.5 rounded-lg text-[11px] font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                    >
                      حذف اليوم
                    </button>
                  </div>

                  {/* Consolidated Product Cards Grid (1 col mobile, 2 cols lg desktop) */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {group.items.map((item, idx) => {
                      const pickKey = `${item.date}__${item.productName}`;
                      const isExpanded = expandedPickKey === pickKey;
                      const isCollectedOnly = item.isCollected && !item.isPlaced;

                      const cardSurfaceClass = item.isPlaced
                        ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/60 opacity-80'
                        : isCollectedOnly
                        ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/70'
                        : item.needsReview
                        ? 'bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-800/80'
                        : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800';

                      return (
                        <div
                          key={pickKey + idx}
                          className={`rounded-[20px] border transition shadow-sm overflow-hidden flex flex-col justify-between ${cardSurfaceClass}`}
                        >
                          <div className="p-4 space-y-3.5">
                            {/* Top Row: Product Title, Missing Units, Camera/Edit/Delete Buttons */}
                            <div className="flex items-start justify-between gap-2.5">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h3
                                    className={`text-sm font-extrabold text-slate-900 dark:text-white leading-snug ${
                                      item.isPlaced ? 'line-through text-slate-500 dark:text-slate-400' : ''
                                    }`}
                                  >
                                    {item.productName}
                                  </h3>
                                </div>

                                {/* Clean Unboxed Metadata Row */}
                                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                                  <span>{item.shelfNames.join('، ') || 'رفوف متعددة'}</span>
                                  <span aria-hidden="true">·</span>
                                  <span
                                    className={`font-bold ${
                                      item.isPlaced
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : isCollectedOnly
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : 'text-slate-500 dark:text-slate-400'
                                    }`}
                                  >
                                    {item.isPlaced
                                      ? 'تم الترتيب على الرف'
                                      : isCollectedOnly
                                      ? 'تم الجمع (في العربة)'
                                      : 'بانتظار التجهيز'}
                                  </span>
                                  {item.needsReview && !item.isPlaced && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-bold text-amber-600 dark:text-amber-400">
                                        مراجعة الدقة ({Math.round(item.minConfidence * 100)}%)
                                      </span>
                                    </>
                                  )}
                                  {item.barcode && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono text-[11px] inline-flex items-center gap-1">
                                        <Barcode className="w-3 h-3" />
                                        {item.barcode}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Prominent Missing Count */}
                              <div className="text-left shrink-0 pl-1">
                                <span
                                  className={`text-2xl font-black block tabular-nums leading-none ${
                                    item.isPlaced
                                      ? 'text-emerald-600/70 dark:text-emerald-400/70'
                                      : isCollectedOnly
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-emerald-600 dark:text-emerald-400'
                                  }`}
                                >
                                  {item.totalMissingUnits}
                                </span>
                                <span className="text-[10px] font-bold text-slate-400">قطعة</span>
                              </div>
                            </div>

                            {/* Action Row: Source Photo Camera Modal Button, Shots Drawer, Quick Edit, Direct Delete */}
                            <div className="flex items-center justify-between gap-2 pt-0.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {/* Camera Button -> Full-Screen Source Photo Viewer with Bounding Box */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setViewingSourceKey({
                                      date: item.date,
                                      productName: item.productName,
                                    })
                                  }
                                  title="عرض صورة الرف المصدر وتحديد موقع المنتج"
                                  aria-label="عرض صورة الرف المصدر"
                                  className="min-h-[44px] px-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition whitespace-nowrap"
                                >
                                  <Camera className="w-4 h-4 shrink-0" />
                                  <span>عرض الرف ({item.sourcePhotoIds.length})</span>
                                </button>

                                {item.entries.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleTogglePickSources(item)}
                                    className="min-h-[44px] px-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold inline-flex items-center gap-1 transition whitespace-nowrap"
                                  >
                                    <ImageIcon className="w-3.5 h-3.5" />
                                    <span>تفاصيل ({item.entries.length})</span>
                                    <ChevronDown
                                      className={`w-3.5 h-3.5 transition-transform ${
                                        isExpanded ? 'rotate-180' : ''
                                      }`}
                                    />
                                  </button>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const target =
                                      item.entries.find(
                                        (e) => e.confidence < 0.7 && !e.isReviewed
                                      ) || item.entries[0];
                                    if (target) {
                                      setEditingLogEntry(target);
                                    }
                                  }}
                                  title="تعديل وتدقيق المنتج"
                                  aria-label="تعديل وتدقيق المنتج"
                                  className="min-h-[44px] min-w-[44px] rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center active:scale-95 transition"
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleDeletePickItem(item)}
                                  title="حذف الصنف مباشرة"
                                  aria-label="حذف الصنف مباشرة"
                                  className="min-h-[44px] min-w-[44px] rounded-xl bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 flex items-center justify-center active:scale-95 transition"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* TWO-STEP FULFILLMENT CHECKLIST (مراحل التجهيز) */}
                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                              {/* Step 1: Collected from Warehouse */}
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={item.isCollected}
                                onClick={() => handleToggleCollected(item)}
                                className={`min-h-[44px] px-2.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 border transition active:scale-[0.98] whitespace-nowrap ${
                                  item.isCollected
                                    ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                                    : 'bg-[#F7F8FA] dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-amber-400'
                                }`}
                              >
                                {item.isCollected ? (
                                  <CheckSquare className="w-4 h-4 shrink-0" />
                                ) : (
                                  <Square className="w-4 h-4 shrink-0 text-slate-400" />
                                )}
                                <ShoppingCart className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                                <span className="truncate">تم الجمع من المخزن</span>
                              </button>

                              {/* Step 2: Placed on Shelf */}
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={item.isPlaced}
                                onClick={() => handleTogglePlaced(item)}
                                className={`min-h-[44px] px-2.5 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 border transition active:scale-[0.98] whitespace-nowrap ${
                                  item.isPlaced
                                    ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                                    : 'bg-[#F7F8FA] dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                                }`}
                              >
                                {item.isPlaced ? (
                                  <CheckSquare className="w-4 h-4 shrink-0" />
                                ) : (
                                  <Square className="w-4 h-4 shrink-0 text-slate-400" />
                                )}
                                <PackageCheck className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                                <span className="truncate">تم الترتيب على الرف</span>
                              </button>
                            </div>
                          </div>

                          {/* Expanded Source Shots Drawer (for aggregated multi-scan items) */}
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-3 border-t border-slate-100 dark:border-slate-800 bg-[#F7F8FA] dark:bg-slate-950/40 space-y-2.5">
                              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
                                اللقطات المدمجة لهذا الصنف ({item.entries.length}):
                              </span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {item.entries.map((entry) => {
                                  const srcPhoto = sourcePhotosCache[entry.photoId];
                                  return (
                                    <div
                                      key={entry.id}
                                      className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 flex items-center justify-between gap-2.5"
                                    >
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setViewingSourceKey({
                                            date: item.date,
                                            productName: item.productName,
                                          })
                                        }
                                        className="flex items-center gap-2.5 min-w-0 text-right flex-1"
                                      >
                                        {srcPhoto ? (
                                          <img
                                            src={srcPhoto.dataUrl}
                                            alt={entry.shelfName || 'صورة الرف'}
                                            className="w-14 h-11 rounded-lg object-cover bg-black shrink-0"
                                          />
                                        ) : (
                                          <div className="w-14 h-11 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                                            <Camera className="w-4 h-4 text-slate-400" />
                                          </div>
                                        )}
                                        <div className="min-w-0">
                                          <span className="text-xs font-bold text-slate-800 dark:text-white block truncate">
                                            {entry.shelfName || 'رف المتجر'}
                                          </span>
                                          <span className="text-[11px] text-slate-400 tabular-nums">
                                            ناقص: {entry.missingUnits} · الثقة:{' '}
                                            {Math.round(entry.confidence * 100)}%
                                          </span>
                                        </div>
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => setEditingLogEntry(entry)}
                                        className="min-h-[38px] px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center gap-1 shrink-0"
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                        <span>تعديل</span>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 2: SESSIONS & PHOTOS ==================== */}
      {activeSubTab === 'sessions' && (
        <div className="space-y-3">
          {sessions.length > 0 && (
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                إجمالي الجولات: {sessions.length}
              </span>
              <button
                type="button"
                onClick={() => setConfirmDeleteAllSessions((v) => !v)}
                className="min-h-[44px] px-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 text-xs font-bold flex items-center gap-1.5 active:scale-95 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف جميع الجولات</span>
              </button>
            </div>
          )}

          {confirmDeleteAllSessions && (
            <div className="p-3.5 rounded-[20px] bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 flex items-center justify-between gap-3 animate-in fade-in">
              <div className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>حذف كل الجولات والصور وسجلات النواقص نهائياً؟</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDeleteAllSessions}
                  disabled={isDeletingSession}
                  className="min-h-[44px] px-3.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold active:scale-95 transition"
                >
                  {isDeletingSession ? 'جاري الحذف...' : 'نعم، احذف الكل'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAllSessions(false)}
                  disabled={isDeletingSession}
                  className="min-h-[44px] px-3 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold border border-slate-200 dark:border-slate-700"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}

          {sessionsLoading ? (
            <div className="py-12 text-center text-slate-400 text-sm font-semibold">
              جاري تحميل الجولات...
            </div>
          ) : sessions.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-[20px] p-8 text-center border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
              <div className="w-16 h-16 rounded-[20px] bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
                <ClipboardList className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white">
                لا توجد جولات مسجلة بعد
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                ابدأ جولة تفقد جديدة عبر شاشة التصوير والتقط صور الأرفف لتظهر سجلاتك هنا تلقائياً.
              </p>
            </div>
          ) : (
            sessions.map((session) => {
              const isExpanded = expandedSessionId === session.id;
              const photos = sessionPhotos[session.id] || [];

              return (
                <div
                  key={session.id}
                  className="bg-white dark:bg-slate-900 rounded-[20px] border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden transition"
                >
                  {/* Session Card Header */}
                  <div className="w-full min-h-[64px] p-4 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                    <button
                      type="button"
                      onClick={() => toggleExpand(session.id)}
                      className="flex-1 flex items-center gap-3 text-right min-w-0"
                    >
                      <div className="w-12 h-12 rounded-[16px] bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Calendar className="w-6 h-6" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {session.name}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 flex-wrap">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>{formatArabicDate(session.startTime)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatPhotoCountLabel(session.photoCount)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={`font-bold ${
                              session.status === 'active'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-400'
                            }`}
                          >
                            {session.status === 'active' ? 'نشطة حالياً' : 'مكتملة'}
                          </span>
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteSessionId(
                            confirmDeleteSessionId === session.id ? null : session.id
                          );
                        }}
                        title="حذف الجولة دون الدخول إليها"
                        aria-label="حذف الجولة"
                        className="min-h-[44px] min-w-[44px] rounded-xl bg-red-50 dark:bg-red-950/40 hover:bg-red-100 text-red-600 dark:text-red-400 flex items-center justify-center active:scale-95 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleExpand(session.id)}
                        aria-label="عرض صور الجولة"
                        className="min-h-[44px] min-w-[40px] flex items-center justify-center text-slate-400"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-5 h-5" />
                        ) : (
                          <ChevronLeft className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Direct Session Delete Confirmation (even when collapsed) */}
                  {confirmDeleteSessionId === session.id && !isExpanded && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/50 border-t border-red-200 dark:border-red-900/50 flex items-center justify-between gap-2 animate-in fade-in">
                      <div className="flex items-center gap-1.5 text-red-700 dark:text-red-300 text-xs font-bold">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>حذف هذه الجولة وجميع صورها؟</span>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDeleteEntireSession(session.id)}
                          disabled={isDeletingSession}
                          className="min-h-[44px] px-3.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl"
                        >
                          {isDeletingSession ? 'جاري الحذف...' : 'نعم، احذف'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteSessionId(null)}
                          className="min-h-[44px] px-3 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl border border-slate-300 dark:border-slate-700"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expanded Photos Grid */}
                  {isExpanded && (
                    <div className="p-4 pt-2 border-t border-slate-100 dark:border-slate-800 bg-[#F7F8FA] dark:bg-slate-950/40 space-y-3">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 px-1">
                        <span>صور الجولة ({photos.length}) · اضغط لتعديل الصورة أو حذفها</span>

                        {confirmDeleteSessionId !== session.id ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteSessionId(session.id)}
                            className="text-[11px] font-semibold text-red-500 hover:text-red-700 flex items-center gap-1 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>حذف الجولة</span>
                          </button>
                        ) : null}
                      </div>

                      {confirmDeleteSessionId === session.id && (
                        <div className="p-3 bg-red-50 dark:bg-red-950/50 rounded-2xl border border-red-200 dark:border-red-900/50 space-y-2 animate-in fade-in">
                          <div className="flex items-center gap-1.5 text-red-700 dark:text-red-300 text-xs font-bold">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>تأكيد حذف الجولة وجميع صورها؟ لا يمكن التراجع.</span>
                          </div>
                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleDeleteEntireSession(session.id)}
                              disabled={isDeletingSession}
                              className="min-h-[44px] px-4 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>{isDeletingSession ? 'جاري الحذف...' : 'نعم، احذف'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteSessionId(null)}
                              disabled={isDeletingSession}
                              className="min-h-[44px] px-4 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl border border-slate-300 dark:border-slate-700"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      )}

                      {photos.length === 0 ? (
                        <div className="py-6 text-center text-xs text-slate-400">
                          لم يتم التقاط صور في هذه الجولة بعد
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                          {photos.map((p) => {
                            const isAnalyzed = p.analysisStatus === 'completed';
                            const isPending = p.analysisStatus === 'pending' || !p.analysisStatus;
                            const productCount = p.analysisResult?.products?.length || 0;

                            return (
                              <div
                                key={p.id}
                                onClick={() => setEditingPhoto(p)}
                                className="group relative rounded-[16px] overflow-hidden bg-slate-200 dark:bg-slate-800 aspect-[4/3] cursor-pointer border border-slate-200 dark:border-slate-700 hover:border-emerald-500 transition shadow-sm"
                              >
                                <img
                                  src={p.dataUrl}
                                  alt="معاينة الرف"
                                  className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                                />

                                {/* Analysis Status Badge, Golden Ref & Direct Delete */}
                                <div className="absolute top-1.5 inset-x-1.5 flex items-center justify-between gap-1">
                                  <div className="flex items-center gap-1 min-w-0">
                                    {p.isGoldenReference && (
                                      <span className="bg-amber-500 text-white p-1 rounded-full shadow-md shrink-0">
                                        <Award className="w-3 h-3" />
                                      </span>
                                    )}
                                    {isAnalyzed ? (
                                      <span className="bg-emerald-600/90 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow truncate">
                                        {productCount} منتج
                                      </span>
                                    ) : p.analysisStatus === 'analyzing' ? (
                                      <span className="bg-blue-600/90 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow animate-pulse">
                                        جاري التحليل
                                      </span>
                                    ) : p.analysisStatus === 'error' ? (
                                      <span className="bg-red-600/90 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                                        فشل التحليل
                                      </span>
                                    ) : isPending ? (
                                      <span className="bg-amber-500/90 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                                        معلق
                                      </span>
                                    ) : null}
                                  </div>

                                  <button
                                    type="button"
                                    onClick={(e) => handleDeletePhotoDirect(p, e)}
                                    title="حذف الصورة مباشرة"
                                    aria-label="حذف الصورة مباشرة"
                                    className="w-7 h-7 rounded-lg bg-black/70 hover:bg-red-600 text-white flex items-center justify-center shadow transition shrink-0"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Capacity Info */}
                                {p.shelfCapacity && (
                                  <span className="absolute bottom-1.5 right-1.5 bg-black/75 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-md">
                                    {p.shelfCapacity} قطعة
                                  </span>
                                )}

                                {/* Aisle or Focused Shelf Info */}
                                {(p.aisle || p.analysisResult?.focused_shelf_label) && (
                                  <span className="absolute bottom-1.5 left-1.5 bg-emerald-600/90 backdrop-blur-sm text-white text-[9px] font-semibold px-1.5 py-0.5 rounded truncate max-w-[90px]">
                                    {p.analysisResult?.focused_shelf_label || p.aisle}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* FULL-SCREEN SOURCE SHELF PHOTO VIEWER WITH BOUNDING BOX & 2-STEP CHECKLIST */}
      <SourceShelfPhotoModal
        isOpen={!!viewingSourceItem}
        item={viewingSourceItem}
        initialPhotosCache={sourcePhotosCache}
        onClose={() => setViewingSourceKey(null)}
        onToggleCollected={handleToggleCollected}
        onTogglePlaced={handleTogglePlaced}
      />

      {/* FULL PHOTO EDITOR & DELETER MODAL */}
      {editingPhoto && (
        <PhotoDetailEditorModal
          isOpen={true}
          photo={editingPhoto}
          onClose={() => setEditingPhoto(null)}
          onSavePhoto={handleUpdatePhoto}
          onDeletePhoto={handleDeletePhoto}
        />
      )}

      {/* QUICK VOICE / TOUCH CORRECTION MODAL */}
      {editingLogEntry && (
        <QuickEditAnalysisModal
          isOpen={true}
          entry={editingLogEntry}
          onClose={() => setEditingLogEntry(null)}
          onSaved={() => {
            loadPickList();
          }}
        />
      )}
    </div>
  );
};
