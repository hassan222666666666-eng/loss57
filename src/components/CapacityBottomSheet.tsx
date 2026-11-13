import React, { useState } from 'react';
import { Check, X, Layers } from 'lucide-react';
import { validateShelfCapacity } from '../utils/imageUtils';

interface CapacityBottomSheetProps {
  isOpen: boolean;
  photoThumbnail?: string;
  onConfirm: (capacity: number | null) => void;
  onSkip: () => void;
}

const PRESET_CAPACITIES = [6, 12, 24, 36, 48];

export const CapacityBottomSheet: React.FC<CapacityBottomSheetProps> = ({
  isOpen,
  photoThumbnail,
  onConfirm,
  onSkip,
}) => {
  const [capacity, setCapacity] = useState<string>('24');

  if (!isOpen) return null;

  const handleSelectPreset = (num: number) => {
    setCapacity(num.toString());
  };

  const handleConfirm = () => {
    const validated = validateShelfCapacity(capacity);
    onConfirm(validated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-[28px] p-6 pb-8 shadow-2xl border-t border-slate-200/80 dark:border-slate-800 animate-in slide-in-from-bottom duration-300"
        dir="rtl"
      >
        {/* Drag handle pill */}
        <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-4" />

        {/* Header with thumbnail if available */}
        <div className="flex items-center gap-4 mb-5">
          {photoThumbnail ? (
            <img
              src={photoThumbnail}
              alt="معاينة الرف الملتقط"
              className="w-16 h-16 rounded-[16px] object-cover border border-slate-200 dark:border-slate-700 shadow-sm shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-[16px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Layers className="w-8 h-8" />
            </div>
          )}
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
              كم قطعة يستوعب هذا الرف بالكامل؟
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              أدخل السعة القصوى للمساعدة في حساب معدل النقص
            </p>
          </div>
        </div>

        {/* Quick-tap preset pills (all >= 52px high) */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
            خيارات سريعة (عدد القطع):
          </label>
          <div className="grid grid-cols-5 gap-2">
            {PRESET_CAPACITIES.map((num) => {
              const isSelected = capacity === num.toString();
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleSelectPreset(num)}
                  className={`min-h-[52px] rounded-[16px] font-bold text-base transition-all flex items-center justify-center border ${
                    isSelected
                      ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20 scale-[1.02]'
                      : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                  }`}
                >
                  {num}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom numeric input (52px high) */}
        <div className="mb-6">
          <label
            htmlFor="capacity-custom-input"
            className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2"
          >
            أو أدخل رقماً مخصصاً:
          </label>
          <div className="relative">
            <input
              id="capacity-custom-input"
              type="number"
              min="1"
              max="5000"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="مثال: 30"
              className="w-full min-h-[52px] px-4 text-center font-bold text-xl rounded-[16px] bg-[#F7F8FA] dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 pointer-events-none">
              قطعة
            </span>
          </div>
        </div>

        {/* Action Buttons: Confirm & Skip (both >= 52px high) */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleConfirm}
            className="min-h-[52px] w-full bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white font-bold text-base rounded-[16px] flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition"
          >
            <Check className="w-5 h-5 stroke-[2.5]" />
            <span>تأكيد</span>
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="min-h-[52px] w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98] text-slate-700 dark:text-slate-300 font-semibold text-base rounded-[16px] flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 transition"
          >
            <X className="w-5 h-5" />
            <span>تخطي</span>
          </button>
        </div>
      </div>
    </div>
  );
};
