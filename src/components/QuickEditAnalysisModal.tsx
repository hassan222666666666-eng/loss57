import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Plus,
  Minus,
  Mic,
  Check,
  Barcode,
  Sparkles,
  AlertTriangle,
  Tag,
} from 'lucide-react';
import { LogEntry, PhotoRecord, ProductRecord } from '../types';
import {
  updateLogEntry,
  getAllProducts,
  saveProduct,
  addShelfCorrection,
  findProductByName,
  getPhotoById,
  saveConsumptionHistory,
} from '../services/db';

interface QuickEditAnalysisModalProps {
  isOpen: boolean;
  entry: LogEntry | null;
  onClose: () => void;
  onSaved: (updatedEntry: LogEntry) => void;
}

export const QuickEditAnalysisModal: React.FC<QuickEditAnalysisModalProps> = ({
  isOpen,
  entry,
  onClose,
  onSaved,
}) => {
  const [productName, setProductName] = useState(entry?.productName || '');
  const [missingUnits, setMissingUnits] = useState(entry?.missingUnits ?? 0);
  const [unitsPresent, setUnitsPresent] = useState(entry?.unitsPresent ?? 0);
  const [barcode, setBarcode] = useState(entry?.barcode || '');
  const [speechLang, setSpeechLang] = useState<'ar-IQ' | 'ar-SA'>('ar-IQ');
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [knownProducts, setKnownProducts] = useState<ProductRecord[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sourcePhoto, setSourcePhoto] = useState<PhotoRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const recognitionRef = useRef<unknown>(null);

  // Sync local state when entry changes
  useEffect(() => {
    if (!entry) return;
    setProductName(entry.productName);
    setMissingUnits(entry.missingUnits);
    setUnitsPresent(entry.unitsPresent);
    setBarcode(entry.barcode || '');
    setSpeechError(null);
    getPhotoById(entry.photoId)
      .then(setSourcePhoto)
      .catch(() => setSourcePhoto(null));
  }, [entry]);

  // Load known products for autocomplete
  useEffect(() => {
    if (!isOpen) return;
    getAllProducts().then(setKnownProducts).catch(console.error);
  }, [isOpen]);

  // Filter autocomplete suggestions based on user typing
  useEffect(() => {
    if (!productName.trim()) {
      setSuggestions([]);
      return;
    }
    const query = productName.trim().toLowerCase();
    const matches = knownProducts
      .map((p) => p.standardizedName)
      .filter((name) => name.toLowerCase().includes(query) && name.toLowerCase() !== query)
      .slice(0, 4);
    setSuggestions(matches);
  }, [productName, knownProducts]);

  if (!isOpen || !entry) return null;

  // Initialize and handle Arabic Speech Recognition (ar-IQ / ar-SA)
  const toggleSpeechRecognition = () => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechError('التعرف على الصوت غير مدعوم في هذا المتصفح.');
      setTimeout(() => setSpeechError(null), 3500);
      return;
    }

    if (isListening && recognitionRef.current) {
      try {
        (recognitionRef.current as { stop: () => void }).stop();
      } catch {
        // Ignore stop errors
      }
      setIsListening(false);
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recognition = new (SpeechRecognition as any)();
      recognition.lang = speechLang;
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsListening(true);
        setSpeechError(null);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        if (event.results && event.results[0] && event.results[0][0]) {
          const spokenText = event.results[0][0].transcript;
          if (spokenText) {
            setProductName(spokenText.trim());
          }
        }
        setIsListening(false);
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setSpeechError('لم يتم التعرف على الصوت بوضوح، يرجى المحاولة ثانية.');
        setIsListening(false);
        setTimeout(() => setSpeechError(null), 3500);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Speech recognition start failed:', err);
      setIsListening(false);
    }
  };

  // Adjust missing units with large touch targets
  const handleIncrement = () => setMissingUnits((prev) => prev + 1);
  const handleDecrement = () => setMissingUnits((prev) => Math.max(0, prev - 1));

  // Save changes and train few-shot learning
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const cleanName = productName.trim() || entry.productName;
      const originalMissing = entry.missingUnits;
      const cleanBarcode = barcode.trim() || undefined;

      const updated: LogEntry = {
        ...entry,
        productName: cleanName,
        missingUnits,
        unitsPresent,
        barcode: cleanBarcode,
        isReviewed: true,
        confidence: Math.max(entry.confidence, 0.95), // Reviewed by human supervisor
      };

      // 1. Update log entry in IndexedDB
      await updateLogEntry(updated);

      // 2. If missing units or name changed, record as few-shot correction for the shelf
      if (entry.shelfId && (originalMissing !== missingUnits || cleanName !== entry.productName)) {
        await addShelfCorrection(entry.shelfId, {
          productName: cleanName,
          previousMissing: originalMissing,
          correctedMissing: missingUnits,
          timestamp: Date.now(),
        });
      }

      // 3. Register or update product registry (including barcode/SKU)
      const existing = await findProductByName(cleanName);
      const estimatedCap = Math.max(1, unitsPresent + missingUnits);
      if (existing) {
        if (cleanBarcode) {
          existing.barcode = cleanBarcode;
        }
        existing.lastSeen = Date.now();
        existing.defaultCapacity = existing.defaultCapacity || estimatedCap;
        await saveProduct(existing);
      } else {
        await saveProduct({
          id: 'prod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          standardizedName: cleanName,
          barcode: cleanBarcode,
          shelfId: entry.shelfId,
          defaultCapacity: estimatedCap,
          lastSeen: Date.now(),
        });
      }

      // 4. Record updated snapshot in consumption_history
      await saveConsumptionHistory([
        {
          id: 'hist_edit_' + entry.id,
          date: entry.date,
          timestamp: Date.now(),
          photoId: entry.photoId,
          shelfId: entry.shelfId,
          shelfName: entry.shelfName,
          productName: cleanName,
          unitsPresent,
          missingUnits,
          estimatedCapacity: estimatedCap,
          restockRatio: estimatedCap > 0 ? Math.min(1, missingUnits / estimatedCap) : 0,
        },
      ]);

      onSaved(updated);
      onClose();
    } catch (err) {
      console.error('Failed to save correction:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const isLowConfidence = entry.confidence < 0.7 && !entry.isReviewed;
  const [ymin, xmin, ymax, xmax] = entry.boundingBox || [0, 0, 0, 0];
  const hasValidBox = ymax > ymin && xmax > xmin;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      dir="rtl"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 my-auto animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                isLowConfidence
                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isLowConfidence ? <AlertTriangle className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                تدقيق وتعديل تحليل الرف
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {entry.shelfName || 'رف المتجر'} · نسبة الثقة: {Math.round(entry.confidence * 100)}%
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white flex items-center justify-center transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Low Confidence Warning Notice */}
        {isLowConfidence && (
          <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/40 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong>تنبيه دقة منخفضة (أقل من 70%):</strong> يرجى التأكد من اسم المنتج والقطع الناقصة
              قبل اعتماد القائمة.
            </div>
          </div>
        )}

        {/* Source Photo Preview with Bounding Box Highlight */}
        {sourcePhoto && (
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-[16/9] border border-slate-200 dark:border-slate-700">
            <img
              src={sourcePhoto.dataUrl}
              alt="موقع المنتج على الرف"
              className="w-full h-full object-contain"
            />
            {hasValidBox && (
              <div
                style={{
                  top: `${ymin / 10}%`,
                  left: `${xmin / 10}%`,
                  height: `${(ymax - ymin) / 10}%`,
                  width: `${(xmax - xmin) / 10}%`,
                }}
                className={`absolute pointer-events-none rounded-lg border-2 ${
                  isLowConfidence ? 'border-amber-400 bg-amber-400/15' : 'border-emerald-400 bg-emerald-400/15'
                }`}
              />
            )}
          </div>
        )}

        {/* 1. Missing Units Adjuster (Big 52px Touch Targets) */}
        <div className="bg-[#F7F8FA] dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-200 dark:border-slate-700/60 space-y-3">
          <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block">
            الوحدات الناقصة المطلوب إحضارها (Missing Units):
          </label>
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={handleDecrement}
              aria-label="إنقاص عدد الوحدات"
              className="min-h-[52px] min-w-[52px] rounded-2xl bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-extrabold text-xl flex items-center justify-center shadow-sm border border-slate-200 dark:border-slate-600 active:scale-95 transition"
            >
              <Minus className="w-6 h-6" />
            </button>

            <div className="text-center">
              <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400 block tabular-nums">
                {missingUnits}
              </span>
              <span className="text-[11px] font-semibold text-slate-400">قطعة مطلوبة</span>
            </div>

            <button
              type="button"
              onClick={handleIncrement}
              aria-label="زيادة عدد الوحدات"
              className="min-h-[52px] min-w-[52px] rounded-2xl bg-white dark:bg-slate-700 text-slate-800 dark:text-white font-extrabold text-xl flex items-center justify-center shadow-sm border border-slate-200 dark:border-slate-600 active:scale-95 transition"
            >
              <Plus className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* 2. Product Name with Voice (ar-IQ / ar-SA) & Autocomplete */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
              اسم المنتج القياسي (Standardized Name):
            </label>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
              {(['ar-IQ', 'ar-SA'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setSpeechLang(lang)}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition ${
                    speechLang === lang
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {lang === 'ar-IQ' ? 'عراقي' : 'سعودي'}
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex items-center">
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="مثال: سائل جلي C4 أخضر 1 لتر"
              className="min-h-[50px] w-full pr-4 pl-14 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
            />

            {/* Arabic Speech Recognition Microphone Button */}
            <button
              type="button"
              onClick={toggleSpeechRecognition}
              title={`إملاء صوتي باللغة العربية (${speechLang})`}
              aria-label="إملاء صوتي"
              className={`absolute left-2 min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition active:scale-95 ${
                isListening
                  ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/40'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100'
              }`}
            >
              <Mic className={`w-5 h-5 ${isListening ? 'animate-bounce' : ''}`} />
            </button>
          </div>

          {speechError && (
            <p className="text-xs text-red-500 font-semibold px-1">{speechError}</p>
          )}

          {/* Autocomplete suggestions */}
          {suggestions.length > 0 && (
            <div className="p-2 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md space-y-1">
              <span className="text-[10px] font-bold text-slate-400 px-2 block">
                اقتراحات من منتجات المتجر:
              </span>
              {suggestions.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => {
                    setProductName(sug);
                    setSuggestions([]);
                  }}
                  className="w-full text-right px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-slate-700/60 flex items-center justify-between transition"
                >
                  <span>{sug}</span>
                  <Tag className="w-3 h-3 text-slate-400" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 3. Barcode / SKU field for POS Integration */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Barcode className="w-4 h-4 text-slate-400" />
            <span>الباركود / رمز SKU (اختياري للربط مع نظام الكاشير):</span>
          </label>
          <input
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="مثال: 6281007012345"
            className="min-h-[48px] w-full px-4 rounded-2xl bg-[#F7F8FA] dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
          />
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="min-h-[52px] rounded-2xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition disabled:opacity-50"
          >
            <Check className="w-5 h-5 stroke-[2.5]" />
            <span>{isSaving ? 'جاري الحفظ والتدريب...' : 'اعتماد وتحديث'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="min-h-[52px] rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
};
