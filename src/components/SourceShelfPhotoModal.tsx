import React, { useEffect, useState } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  Eye,
  EyeOff,
  PackageCheck,
  ShoppingCart,
  ChevronRight,
  ChevronLeft,
  MapPin,
  ImageOff,
} from 'lucide-react';
import { DailyPickItem, PhotoRecord } from '../types';
import { getPhotoById } from '../services/db';
import { formatArabicDate } from '../utils/imageUtils';

interface SourceShelfPhotoModalProps {
  isOpen: boolean;
  item: DailyPickItem | null;
  initialPhotosCache?: Record<string, PhotoRecord>;
  onClose: () => void;
  onToggleCollected: (item: DailyPickItem) => void;
  onTogglePlaced: (item: DailyPickItem) => void;
}

export const SourceShelfPhotoModal: React.FC<SourceShelfPhotoModalProps> = ({
  isOpen,
  item,
  initialPhotosCache = {},
  onClose,
  onToggleCollected,
  onTogglePlaced,
}) => {
  const [photosMap, setPhotosMap] = useState<Record<string, PhotoRecord>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [showHighlight, setShowHighlight] = useState(true);
  const [isZoomed, setIsZoomed] = useState(false);

  // Deduplicate entries by photoId while keeping each entry's boundingBox & shelf info
  const sourceEntries = item ? item.entries : [];
  const activeEntry = sourceEntries[activeIndex] || sourceEntries[0];

  useEffect(() => {
    if (!isOpen || !item) return;
    setActiveIndex(0);
    setIsZoomed(false);
    setShowHighlight(true);

    const uniqueIds = Array.from(new Set(item.entries.map((e) => e.photoId)));
    const seeded: Record<string, PhotoRecord> = {};
    const missingIds: string[] = [];

    uniqueIds.forEach((id) => {
      if (initialPhotosCache[id]) {
        seeded[id] = initialPhotosCache[id];
      } else {
        missingIds.push(id);
      }
    });

    setPhotosMap((prev) => ({ ...prev, ...seeded }));

    if (missingIds.length > 0) {
      setLoadingPhoto(true);
      Promise.all(missingIds.map((id) => getPhotoById(id)))
        .then((loaded) => {
          setPhotosMap((prev) => {
            const next = { ...prev };
            loaded.forEach((p) => {
              if (p) next[p.id] = p;
            });
            return next;
          });
        })
        .catch(console.error)
        .finally(() => setLoadingPhoto(false));
    }
  }, [isOpen, item, initialPhotosCache]);

  if (!isOpen || !item || !activeEntry) return null;

  const activePhoto = photosMap[activeEntry.photoId] || initialPhotosCache[activeEntry.photoId];
  const [ymin, xmin, ymax, xmax] = activeEntry.boundingBox || [0, 0, 0, 0];
  const hasValidBox = ymax > ymin && xmax > xmin;
  const focusedShelfBox = activePhoto?.analysisResult?.focused_shelf_box;
  const isDistinctShelfBox =
    focusedShelfBox &&
    !(
      focusedShelfBox[0] === ymin &&
      focusedShelfBox[1] === xmin &&
      focusedShelfBox[2] === ymax &&
      focusedShelfBox[3] === xmax
    );

  const imgRatio =
    activePhoto && activePhoto.width > 0 && activePhoto.height > 0
      ? `${activePhoto.width} / ${activePhoto.height}`
      : '4 / 3';

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col select-none animate-in fade-in duration-150"
      dir="rtl"
    >
      {/* Top Bar */}
      <header className="px-4 py-3 border-b border-white/10 bg-slate-900/90 flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm sm:text-base font-extrabold text-white truncate">
            {item.productName}
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-300 mt-0.5 flex-wrap">
            <span className="font-bold text-emerald-400 tabular-nums">
              المطلوب: {item.totalMissingUnits} قطعة
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 text-slate-300 truncate">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              {activeEntry.shelfName || 'رف المتجر'}
            </span>
            {activePhoto && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-400">{formatArabicDate(activePhoto.timestamp)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowHighlight((v) => !v)}
            aria-label={showHighlight ? 'إخفاء تحديد الموقع' : 'إظهار تحديد الموقع'}
            className="min-h-[44px] px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 transition"
          >
            {showHighlight ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            <span className="hidden sm:inline">{showHighlight ? 'إخفاء المربع' : 'إظهار المربع'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsZoomed((z) => !z)}
            aria-label={isZoomed ? 'تصغير الصورة' : 'تكبير الصورة'}
            className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
          >
            {isZoomed ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق معاينة الصورة"
            className="min-h-[44px] min-w-[44px] rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Full-Screen Image Canvas with Aligned Bounding Box */}
      <div className="flex-1 relative overflow-auto flex items-center justify-center p-3 sm:p-6">
        {loadingPhoto && !activePhoto ? (
          <div className="text-slate-400 text-sm font-semibold">
            جاري استرجاع الصورة من الذاكرة المحلية...
          </div>
        ) : !activePhoto ? (
          <div className="text-center space-y-3 p-6">
            <div className="w-16 h-16 rounded-2xl bg-white/10 text-slate-400 flex items-center justify-center mx-auto">
              <ImageOff className="w-8 h-8" />
            </div>
            <p className="text-sm font-bold text-slate-300">
              تعذر العثور على الصورة الأصلية في الذاكرة المحلية
            </p>
          </div>
        ) : (
          <div
            style={{ aspectRatio: imgRatio }}
            className={`relative max-w-full max-h-full rounded-2xl overflow-hidden bg-black shadow-2xl border border-white/15 transition-transform duration-200 ${
              isZoomed ? 'scale-150 sm:scale-[1.75] cursor-zoom-out' : 'cursor-zoom-in'
            }`}
            onClick={() => setIsZoomed((z) => !z)}
          >
            <img
              src={activePhoto.dataUrl}
              alt={`صورة الرف المصدر للمنتج ${item.productName}`}
              className="w-full h-full object-contain block"
            />

            {/* Optional Isolated Single-Shelf Frame */}
            {showHighlight && isDistinctShelfBox && focusedShelfBox && (
              <div
                style={{
                  top: `${focusedShelfBox[0] / 10}%`,
                  left: `${focusedShelfBox[1] / 10}%`,
                  height: `${(focusedShelfBox[2] - focusedShelfBox[0]) / 10}%`,
                  width: `${(focusedShelfBox[3] - focusedShelfBox[1]) / 10}%`,
                }}
                className="absolute pointer-events-none rounded-xl border border-dashed border-sky-400/80"
              />
            )}

            {/* Highlighted Glowing Product Bounding Box */}
            {showHighlight && hasValidBox && (
              <div
                style={{
                  top: `${ymin / 10}%`,
                  left: `${xmin / 10}%`,
                  height: `${(ymax - ymin) / 10}%`,
                  width: `${(xmax - xmin) / 10}%`,
                }}
                className="absolute pointer-events-none rounded-xl border-[3px] border-emerald-400 bg-emerald-400/15 shadow-[0_0_24px_rgba(16,185,129,0.65)] ring-2 ring-white/40"
              >
                <div className="absolute -top-7 right-0 px-2.5 py-1 rounded-lg bg-emerald-500 text-white text-[11px] font-extrabold whitespace-nowrap shadow-lg flex items-center gap-1.5">
                  <span>{item.productName}</span>
                  <span className="tabular-nums bg-black/25 px-1.5 py-0.5 rounded">
                    -{activeEntry.missingUnits}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Multi-Source Photo Switcher (when aggregated across multiple scans) */}
      {sourceEntries.length > 1 && (
        <div className="px-4 py-2 bg-slate-900/80 border-t border-white/10 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
            disabled={activeIndex === 0}
            className="min-h-[44px] px-3 rounded-xl bg-white/10 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
            <span>السابقة</span>
          </button>

          <div className="text-xs text-slate-200 font-bold text-center truncate">
            صورة {activeIndex + 1} من {sourceEntries.length} · نقص في هذه اللقطة:{' '}
            <span className="text-emerald-400 tabular-nums">{activeEntry.missingUnits}</span> قطعة
          </div>

          <button
            type="button"
            onClick={() => setActiveIndex((i) => Math.min(sourceEntries.length - 1, i + 1))}
            disabled={activeIndex === sourceEntries.length - 1}
            className="min-h-[44px] px-3 rounded-xl bg-white/10 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-30"
          >
            <span>التالية</span>
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bottom Two-Step Fulfillment Quick Bar */}
      <footer className="p-3 sm:p-4 bg-slate-900 border-t border-white/10 shrink-0">
        <div className="max-w-2xl mx-auto grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onToggleCollected(item)}
            className={`min-h-[48px] px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition active:scale-[0.98] border ${
              item.isCollected
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-500/20'
                : 'bg-white/10 hover:bg-white/15 text-white border-white/15'
            }`}
          >
            <ShoppingCart className="w-4 h-4 shrink-0" />
            <span>{item.isCollected ? 'تم الجمع من المخزن ✓' : 'تم الجمع من المخزن'}</span>
          </button>

          <button
            type="button"
            onClick={() => onTogglePlaced(item)}
            className={`min-h-[48px] px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition active:scale-[0.98] border ${
              item.isPlaced
                ? 'bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-500/25'
                : 'bg-white/10 hover:bg-white/15 text-white border-white/15'
            }`}
          >
            <PackageCheck className="w-4 h-4 shrink-0" />
            <span>{item.isPlaced ? 'تم الترتيب على الرف ✓' : 'تم الترتيب على الرف'}</span>
          </button>
        </div>
      </footer>
    </div>
  );
};
