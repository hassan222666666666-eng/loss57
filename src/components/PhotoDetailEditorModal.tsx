import React, { useState, useEffect } from 'react';
import {
  X,
  Trash2,
  Award,
  Clock,
  RotateCw,
  SunMedium,
  Check,
  Save,
  Tag,
  FileText,
  Layers,
  AlertTriangle,
  Sparkles,
  Eye,
} from 'lucide-react';
import { PhotoRecord } from '../types';
import {
  formatArabicDate,
  validateShelfCapacity,
  rotateImage,
  adjustImageBrightnessContrast,
} from '../utils/imageUtils';
import { saveGoldenReference, findOrCreateShelf, getSettings, updateShelfCapacity } from '../services/db';
import { analysisQueue } from '../services/analysisQueue';

interface PhotoDetailEditorModalProps {
  isOpen: boolean;
  photo: PhotoRecord | null;
  onClose: () => void;
  onSavePhoto: (updatedPhoto: PhotoRecord) => Promise<void>;
  onDeletePhoto: (photoId: string) => Promise<void>;
}

const CAPACITY_PRESETS = [6, 12, 24, 36, 48, 60];
const CATEGORY_PRESETS = [
  'الألبان والأجبان',
  'المعلبات',
  'الزيوت والمؤن',
  'المشروبات والعصائر',
  'الحبوب والإفطار',
  'المنظفات والورقيات',
  'البسكويت والسناكس',
];

export const PhotoDetailEditorModal: React.FC<PhotoDetailEditorModalProps> = ({
  isOpen,
  photo,
  onClose,
  onSavePhoto,
  onDeletePhoto,
}) => {
  // Local editing states initialized from current photo
  const [currentDataUrl, setCurrentDataUrl] = useState<string>(photo?.dataUrl || '');
  const [currentWidth, setCurrentWidth] = useState<number>(photo?.width || 0);
  const [currentHeight, setCurrentHeight] = useState<number>(photo?.height || 0);
  const [capacityInput, setCapacityInput] = useState<string>(
    photo?.shelfCapacity ? photo.shelfCapacity.toString() : ''
  );
  const [aisleInput, setAisleInput] = useState<string>(photo?.aisle || '');
  const [notesInput, setNotesInput] = useState<string>(photo?.notes || '');
  const [isGoldenRef, setIsGoldenRef] = useState<boolean>(photo?.isGoldenReference || false);
  const [allowGoldenRef, setAllowGoldenRef] = useState<boolean>(true);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState<boolean>(true);

  // Status & Confirmation states
  const [isRotating, setIsRotating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isEnhanced, setIsEnhanced] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAnalyzingThisPhoto, setIsAnalyzingThisPhoto] = useState(false);
  const [analysisPhotoResult, setAnalysisPhotoResult] = useState(photo?.analysisResult || null);

  useEffect(() => {
    getSettings()
      .then((s) => setAllowGoldenRef(s.useGoldenReference))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!photo) return;
    setCurrentDataUrl(photo.dataUrl);
    setCurrentWidth(photo.width);
    setCurrentHeight(photo.height);
    setCapacityInput(photo.shelfCapacity ? photo.shelfCapacity.toString() : '');
    setAisleInput(photo.aisle || '');
    setNotesInput(photo.notes || '');
    setIsGoldenRef(photo.isGoldenReference);
    setAnalysisPhotoResult(photo.analysisResult || null);
    setIsEnhanced(false);
    setShowDeleteConfirm(false);
  }, [photo]);

  if (!isOpen || !photo) return null;

  // Trigger Gemini Vision analysis on demand
  const handleAnalyzeNow = async () => {
    setIsAnalyzingThisPhoto(true);
    try {
      const res = await analysisQueue.analyzeSinglePhoto({
        ...photo,
        dataUrl: currentDataUrl,
        aisle: aisleInput.trim() || undefined,
        shelfCapacity: validateShelfCapacity(capacityInput),
        isGoldenReference: isGoldenRef,
      });
      if (res) {
        setAnalysisPhotoResult(res);
      }
    } catch (err) {
      console.error('Single photo analyze error:', err);
    } finally {
      setIsAnalyzingThisPhoto(false);
    }
  };

  // Handle 90° Image Rotation
  const handleRotate = async () => {
    if (isRotating) return;
    setIsRotating(true);
    try {
      const result = await rotateImage(currentDataUrl, 90);
      setCurrentDataUrl(result.dataUrl);
      setCurrentWidth(result.width);
      setCurrentHeight(result.height);
    } catch (err) {
      console.error('Failed to rotate photo:', err);
    } finally {
      setIsRotating(false);
    }
  };

  // Handle Brightness & Contrast Boost for Dark Supermarket Aisles
  const handleToggleEnhance = async () => {
    if (isEnhancing) return;
    setIsEnhancing(true);
    try {
      if (!isEnhanced) {
        const enhanced = await adjustImageBrightnessContrast(currentDataUrl, 118, 112);
        setCurrentDataUrl(enhanced);
        setIsEnhanced(true);
      } else {
        // Revert to original
        setCurrentDataUrl(photo.dataUrl);
        setIsEnhanced(false);
      }
    } catch (err) {
      console.error('Failed to enhance photo:', err);
    } finally {
      setIsEnhancing(false);
    }
  };

  // Handle Capacity preset tap
  const handlePresetSelect = (val: number) => {
    setCapacityInput(val.toString());
  };

  // Handle Aisle preset chip tap
  const handleCategorySelect = (cat: string) => {
    setAisleInput(cat);
  };

  // Handle Saving all changes
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const validatedCapacity = validateShelfCapacity(capacityInput);
      const shelf = await findOrCreateShelf(aisleInput, photo.shelfNumber).catch(() => null);
      const updated: PhotoRecord = {
        ...photo,
        dataUrl: currentDataUrl,
        width: currentWidth,
        height: currentHeight,
        shelfCapacity: validatedCapacity,
        aisle: aisleInput.trim() || undefined,
        notes: notesInput.trim() || undefined,
        isGoldenReference: isGoldenRef,
        shelfMatchId: shelf?.id || photo.shelfMatchId,
        analysisResult: analysisPhotoResult || photo.analysisResult,
      };

      // Update shelf capacity so future scans skip asking
      if (shelf && validatedCapacity) {
        await updateShelfCapacity(shelf.id, validatedCapacity).catch(() => {});
      }

      // If marked as Golden Reference, persist to shelf in IndexedDB
      if (isGoldenRef && shelf) {
        await saveGoldenReference(shelf.id, photo.id, currentDataUrl, validatedCapacity).catch((e) =>
          console.warn('Golden ref save error:', e)
        );
      }

      await onSavePhoto(updated);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 600);
    } catch (err) {
      console.error('Failed to save photo updates:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Delete Confirmation
  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await onDeletePhoto(photo.id);
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      console.error('Failed to delete photo:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 overflow-y-auto"
      dir="rtl"
    >
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl flex flex-col max-h-[92vh] overflow-hidden border border-slate-200 dark:border-slate-800 my-auto animate-in zoom-in-95 duration-200">
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                تعديل وتفاصيل صورة الرف
              </h2>
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{formatArabicDate(photo.timestamp)}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[52px] min-w-[52px] rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center transition active:scale-95"
            aria-label="إغلاق النافذة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL SCROLLABLE BODY */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* PHOTO PREVIEW & IMAGE EDITING TOOLS */}
          <div className="space-y-2">
            <div className="relative rounded-[22px] overflow-hidden bg-black aspect-[4/3] flex items-center justify-center border border-slate-200 dark:border-slate-800 shadow-inner group">
              <img
                src={currentDataUrl}
                alt="معاينة الرف"
                className="w-full h-full object-contain"
              />

              {/* Automatically Isolated Single-Shelf Boundary */}
              {showBoundingBoxes && analysisPhotoResult?.focused_shelf_box && (
                <div
                  style={{
                    top: `${analysisPhotoResult.focused_shelf_box[0] / 10}%`,
                    left: `${analysisPhotoResult.focused_shelf_box[1] / 10}%`,
                    height: `${(analysisPhotoResult.focused_shelf_box[2] - analysisPhotoResult.focused_shelf_box[0]) / 10}%`,
                    width: `${(analysisPhotoResult.focused_shelf_box[3] - analysisPhotoResult.focused_shelf_box[1]) / 10}%`,
                  }}
                  className="absolute pointer-events-none rounded-xl border-2 border-dashed border-sky-400 bg-sky-400/10"
                >
                  <span className="absolute -top-5 right-0 px-2 py-0.5 rounded bg-sky-600 text-white text-[10px] font-bold whitespace-nowrap shadow">
                    رف واحد معزول: {analysisPhotoResult.focused_shelf_label || 'الرف الأوسط'}
                  </span>
                </div>
              )}

              {/* Bounding Box Overlays from Gemini Vision */}
              {showBoundingBoxes &&
                analysisPhotoResult?.products?.map((prod, idx) => {
                  const [ymin, xmin, ymax, xmax] = prod.bounding_box || [0, 0, 0, 0];
                  if (ymax <= ymin || xmax <= xmin) return null;
                  const fBox = analysisPhotoResult?.focused_shelf_box;
                  if (
                    fBox &&
                    ymin === fBox[0] &&
                    xmin === fBox[1] &&
                    ymax === fBox[2] &&
                    xmax === fBox[3]
                  ) {
                    return null;
                  }
                  const isLow = prod.confidence < 0.7;
                  return (
                    <div
                      key={prod.standardized_name + idx}
                      style={{
                        top: `${ymin / 10}%`,
                        left: `${xmin / 10}%`,
                        height: `${(ymax - ymin) / 10}%`,
                        width: `${(xmax - xmin) / 10}%`,
                      }}
                      className={`absolute pointer-events-none rounded-lg border-2 ${
                        isLow ? 'border-amber-400 bg-amber-400/10' : 'border-emerald-400 bg-emerald-400/10'
                      }`}
                    >
                      <span
                        className={`absolute -top-5 right-0 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap shadow ${
                          isLow ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'
                        }`}
                      >
                        {prod.standardized_name} (-{prod.missing_units})
                      </span>
                    </div>
                  );
                })}

              {/* Badges on preview */}
              {isGoldenRef && (
                <div className="absolute top-3 right-3 bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg">
                  <Award className="w-4 h-4" />
                  <span>مرجع الرف الممتلئ</span>
                </div>
              )}

              {analysisPhotoResult?.products?.length ? (
                <button
                  type="button"
                  onClick={() => setShowBoundingBoxes((v) => !v)}
                  className="absolute top-3 left-3 bg-black/70 hover:bg-black/90 backdrop-blur-md text-white text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 border border-white/20"
                >
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{showBoundingBoxes ? 'إخفاء المربعات' : 'إظهار المربعات'}</span>
                </button>
              ) : null}

              {/* Floating Image Tools Bar */}
              <div className="absolute bottom-3 inset-x-3 flex items-center justify-between pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-2">
                  {/* Rotate 90 deg */}
                  <button
                    type="button"
                    onClick={handleRotate}
                    disabled={isRotating}
                    className="min-h-[46px] px-3.5 bg-black/70 hover:bg-black/90 backdrop-blur-md text-white rounded-xl text-xs font-bold flex items-center gap-1.5 border border-white/20 active:scale-95 transition"
                    title="تدوير الصورة 90 درجة في اتجاه عقارب الساعة"
                  >
                    <RotateCw className={`w-4 h-4 ${isRotating ? 'animate-spin' : ''}`} />
                    <span>تدوير 90°</span>
                  </button>

                  {/* Brightness/Lighting boost */}
                  <button
                    type="button"
                    onClick={handleToggleEnhance}
                    disabled={isEnhancing}
                    className={`min-h-[46px] px-3.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border backdrop-blur-md active:scale-95 transition ${
                      isEnhanced
                        ? 'bg-amber-500 text-white border-amber-400'
                        : 'bg-black/70 hover:bg-black/90 text-white border-white/20'
                    }`}
                    title="تحسين إضاءة وتباين الصورة لرفوف المستودع"
                  >
                    <SunMedium className="w-4 h-4" />
                    <span>{isEnhanced ? 'إلغاء التحسين' : 'تحسين الإضاءة'}</span>
                  </button>
                </div>

                {/* Dimensions badge */}
                <span className="pointer-events-auto bg-black/70 backdrop-blur-md text-white/90 text-[11px] font-mono px-2.5 py-1 rounded-lg border border-white/10">
                  {currentWidth} × {currentHeight}
                </span>
              </div>
            </div>
          </div>

          {/* EDIT FORM FIELDS */}
          <div className="space-y-4">
            {/* 1. CAPACITY FIELD */}
            <div className="bg-[#F7F8FA] dark:bg-slate-800/60 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <span>سعة الرف القصوى (عدد القطع)</span>
                </label>
                {capacityInput && (
                  <button
                    type="button"
                    onClick={() => setCapacityInput('')}
                    className="text-[11px] font-semibold text-slate-400 hover:text-red-500"
                  >
                    مسح السعة
                  </button>
                )}
              </div>

              {/* Numeric input */}
              <input
                type="number"
                min="1"
                max="5000"
                value={capacityInput}
                onChange={(e) => setCapacityInput(e.target.value)}
                placeholder="أدخل عدد القطع التي يستوعبها الرف..."
                className="w-full min-h-[52px] px-4 rounded-xl font-bold text-base text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />

              {/* Quick Preset Pills (>= 48px) */}
              <div className="flex flex-wrap gap-2 pt-1">
                {CAPACITY_PRESETS.map((val) => {
                  const isSelected = capacityInput === val.toString();
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => handlePresetSelect(val)}
                      className={`min-h-[44px] px-3.5 rounded-xl font-bold text-xs transition active:scale-95 border ${
                        isSelected
                          ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                      }`}
                    >
                      {val} قطعة
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. AISLE / CATEGORY FIELD */}
            <div className="bg-[#F7F8FA] dark:bg-slate-800/60 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-700/60 space-y-3">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-emerald-500" />
                <span>القسم أو الممر (التصنيف)</span>
              </label>

              <input
                type="text"
                value={aisleInput}
                onChange={(e) => setAisleInput(e.target.value)}
                placeholder="مثال: ممر 3 - رف الألبان الأوسط"
                className="w-full min-h-[52px] px-4 rounded-xl font-medium text-sm text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />

              {/* Category chips */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {CATEGORY_PRESETS.map((cat) => {
                  const isSelected = aisleInput.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => handleCategorySelect(cat)}
                      className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold transition border active:scale-95 ${
                        isSelected
                          ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. NOTES FIELD */}
            <div className="bg-[#F7F8FA] dark:bg-slate-800/60 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-700/60 space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-emerald-500" />
                <span>ملاحظات التعبئة والمستودع</span>
              </label>
              <textarea
                rows={2}
                value={notesInput}
                onChange={(e) => setNotesInput(e.target.value)}
                placeholder="أضف ملاحظات عن حالة الرف أو متطلبات التعبئة..."
                className="w-full p-3 rounded-xl font-normal text-sm text-slate-900 dark:text-white bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
              />
            </div>

            {/* 4. GOLDEN REFERENCE TOGGLE (Controlled by Settings Toggle) */}
            {allowGoldenRef && (
              <div
                onClick={() => setIsGoldenRef(!isGoldenRef)}
                className={`p-4 rounded-[20px] border flex items-center justify-between cursor-pointer transition select-none ${
                  isGoldenRef
                    ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800'
                    : 'bg-[#F7F8FA] dark:bg-slate-800/60 border-slate-200/80 dark:border-slate-700/60 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
                      isGoldenRef
                        ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                    }`}
                  >
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      حفظ كصورة مرجعية للرف الممتلئ
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      تُستخدم للمقارنة جنباً إلى جنب مع الصور الجديدة لحساب النواقص بدقة
                    </p>
                  </div>
                </div>

                <div
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${
                    isGoldenRef
                      ? 'bg-amber-500 border-amber-500 text-white'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {isGoldenRef && <Check className="w-4 h-4 stroke-[3]" />}
                </div>
              </div>
            )}

            {/* 5. GEMINI VISION ANALYSIS CARD */}
            <div className="bg-[#F7F8FA] dark:bg-slate-800/60 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-white">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  <span>نتائج تحليل الذكاء الاصطناعي (Gemini Vision)</span>
                </div>
                <button
                  type="button"
                  onClick={handleAnalyzeNow}
                  disabled={isAnalyzingThisPhoto}
                  className="min-h-[36px] px-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-xs flex items-center gap-1 shadow-sm transition disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isAnalyzingThisPhoto ? 'جاري التحليل...' : 'تحليل الصورة الآن'}</span>
                </button>
              </div>

              {analysisPhotoResult?.focused_shelf_label && (
                <div className="text-[11px] font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 px-2.5 py-1.5 rounded-xl">
                  نطاق التحليل التلقائي: {analysisPhotoResult.focused_shelf_label} (رف واحد فقط)
                </div>
              )}

              {analysisPhotoResult && analysisPhotoResult.products.length > 0 ? (
                <div className="space-y-2 pt-1">
                  {analysisPhotoResult.products.map((prod, pIdx) => {
                    const isLowConf = prod.confidence < 0.7;
                    return (
                      <div
                        key={prod.standardized_name + pIdx}
                        className={`p-2.5 rounded-xl bg-white dark:bg-slate-900 border flex items-center justify-between text-xs ${
                          isLowConf
                            ? 'border-amber-300 dark:border-amber-700 bg-amber-50/30'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900 dark:text-white">
                              {prod.standardized_name}
                            </span>
                            {isLowConf && (
                              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                                مراجعة الدقة
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400">
                            المتوفر: {prod.units_present} · الثقة: {Math.round(prod.confidence * 100)}%
                          </span>
                        </div>
                        <div className="text-left font-bold text-emerald-600 dark:text-emerald-400">
                          <span className="text-sm tabular-nums">{prod.missing_units}</span> قطعة ناقصة
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : photo.analysisStatus === 'error' && photo.analysisError ? (
                <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed font-semibold">
                  تعذر التحليل: {photo.analysisError} — اضغط &quot;تحليل الصورة الآن&quot; لإعادة المحاولة.
                </p>
              ) : (
                <p className="text-xs text-slate-400 leading-relaxed">
                  لم يتم تحليل هذه الصورة بعد أو أنها قيد المعالجة في قائمة الانتظار. يمكنك النقر على &quot;تحليل الصورة الآن&quot; لفحص المنتجات والنواقص فورياً.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* MODAL FOOTER ACTIONS */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-[#F7F8FA] dark:bg-slate-900/80 shrink-0 space-y-3">
          {showDeleteConfirm ? (
            /* Inline Delete Confirmation Dialog */
            <div className="p-3.5 bg-red-50 dark:bg-red-950/40 rounded-2xl border border-red-200 dark:border-red-800 space-y-3 animate-in fade-in">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="text-xs font-bold">
                  هل أنت متأكد من حذف هذه الصورة نهائياً؟ لا يمكن التراجع.
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="min-h-[52px] bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2 shadow-sm transition"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{isDeleting ? 'جاري الحذف...' : 'نعم، احذف الصورة'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="min-h-[52px] bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-sm rounded-xl border border-slate-300 dark:border-slate-600 hover:bg-slate-100 active:scale-95 transition"
                >
                  إلغاء
                </button>
              </div>
            </div>
          ) : (
            /* Standard Action Buttons (>= 52px targets) */
            <div className="grid grid-cols-3 gap-2">
              {/* Delete Button */}
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="col-span-1 min-h-[52px] rounded-2xl bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 font-bold text-sm flex items-center justify-center gap-2 border border-red-200 dark:border-red-800/60 active:scale-95 transition"
              >
                <Trash2 className="w-4 h-4" />
                <span>حذف</span>
              </button>

              {/* Save Changes Button */}
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className={`col-span-2 min-h-[52px] rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition active:scale-[0.98] ${
                  saveSuccess
                    ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/25'
                }`}
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-5 h-5 stroke-[3]" />
                    <span>تم حفظ التعديلات!</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>{isSaving ? 'جاري الحفظ...' : 'حفظ التعديلات'}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
