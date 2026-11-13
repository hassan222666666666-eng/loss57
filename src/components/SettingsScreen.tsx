import React, { useState } from 'react';
import {
  Camera,
  Volume2,
  VolumeX,
  Layers,
  Award,
  Download,
  Trash2,
  Moon,
  Sun,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Info,
  HelpCircle,
  AlertTriangle,
  Zap,
  ZoomIn,
} from 'lucide-react';
import { AppSettings } from '../types';
import { saveSettings, clearAllData, exportAllData } from '../services/db';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface SettingsScreenProps {
  settings: AppSettings;
  onSettingsChange: (newSettings: AppSettings) => void;
  onDataCleared: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  onSettingsChange,
  onDataCleared,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Toggle handler
  const handleToggle = async (key: keyof AppSettings) => {
    const updatedVal = !settings[key];
    const updated = await saveSettings({ [key]: updatedVal });
    onSettingsChange(updated);
  };

  // Analysis pace selector
  const handlePaceModeChange = async (analysisPaceMode: 'safe' | 'fast' | 'parallel') => {
    const updated = await saveSettings({ analysisPaceMode });
    onSettingsChange(updated);
  };

  // Theme changer
  const handleThemeChange = async (theme: 'system' | 'light' | 'dark') => {
    const updated = await saveSettings({ theme });
    onSettingsChange(updated);

    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (theme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  };

  // Export JSON backup
  const handleExport = async () => {
    try {
      const json = await exportAllData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rofoof_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportNotice('تم تصدير ملف النسخة الاحتياطية بنجاح!');
      setTimeout(() => setExportNotice(null), 3500);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  // Clear all data
  const handleClearAll = async () => {
    try {
      await clearAllData();
      setShowClearConfirm(false);
      onDataCleared();
      setExportNotice('تم مسح جميع البيانات وقاعدة البيانات المحلية.');
      setTimeout(() => setExportNotice(null), 3500);
    } catch (err) {
      console.error('Clear failed:', err);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-6 pb-28 space-y-6" dir="rtl">
      {/* Top Title Banner */}
      <div className="px-2">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
          الإعدادات والتفضيلات
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          تخصيص سلوك الكاميرا، إدارة التخزين المستمر وتجهيزات الذكاء الاصطناعي
        </p>
      </div>

      {/* Success / Alert notice */}
      {exportNotice && (
        <div className="rounded-[18px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-4 text-emerald-800 dark:text-emerald-300 text-sm font-semibold flex items-center gap-2 animate-in fade-in duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* CARD 1: Camera & Capture Behaviors */}
      <div className="bg-white dark:bg-slate-900 rounded-[20px] p-5 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-2">
        <h2 className="text-sm font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-3 px-1">
          إعدادات التصوير والالتقاط
        </h2>

        {/* Toggle 1: Continuous Capture */}
        <div
          onClick={() => handleToggle('continuousCapture')}
          className="min-h-[52px] py-2 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-white block">
                التصوير المستمر
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                حفظ الصورة فوراً وإبقاء الكاميرا قيد العمل لالتقاط أرفف متتالية
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.continuousCapture}
            aria-label="التصوير المستمر"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle('continuousCapture');
            }}
            className="min-h-[52px] min-w-[56px] px-2 flex items-center justify-center focus:outline-none"
          >
            <div
              className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-200 ${
                settings.continuousCapture ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-200 ${
                  settings.continuousCapture ? '-translate-x-6' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>

        {/* Toggle 2: Ask Shelf Capacity */}
        <div
          onClick={() => handleToggle('askShelfCapacity')}
          className="min-h-[52px] py-2 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-white block">
                السؤال عن سعة الرف بعد كل صورة
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                إظهار نافذة سفلية سريعة لتسجيل أقصى استيعاب للرف بعد كل لقطة
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.askShelfCapacity}
            aria-label="السؤال عن سعة الرف بعد كل صورة"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle('askShelfCapacity');
            }}
            className="min-h-[52px] min-w-[56px] px-2 flex items-center justify-center focus:outline-none"
          >
            <div
              className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-200 ${
                settings.askShelfCapacity ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-200 ${
                  settings.askShelfCapacity ? '-translate-x-6' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>

        {/* Toggle 3: Use Golden Reference */}
        <div
          onClick={() => handleToggle('useGoldenReference')}
          className="min-h-[52px] py-2 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-white block">
                استخدام صورة مرجعية للرف الممتلئ
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                إتاحة زر وسام لتعيين صورة الرف كمخطط مرجعي مثالي للمقارنة لاحقاً
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.useGoldenReference}
            aria-label="استخدام صورة مرجعية للرف الممتلئ"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle('useGoldenReference');
            }}
            className="min-h-[52px] min-w-[56px] px-2 flex items-center justify-center focus:outline-none"
          >
            <div
              className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-200 ${
                settings.useGoldenReference ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-200 ${
                  settings.useGoldenReference ? '-translate-x-6' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>

        {/* Toggle 4: Shutter Sound */}
        <div
          onClick={() => handleToggle('shutterSound')}
          className="min-h-[52px] py-2 flex items-center justify-between gap-4 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
              {settings.shutterSound ? (
                <Volume2 className="w-5 h-5" />
              ) : (
                <VolumeX className="w-5 h-5" />
              )}
            </div>
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-white block">
                صوت الالتقاط
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                تشغيل نقرة ميكانيكية خفيفة تؤكد التقاط كل صورة بنجاح
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.shutterSound}
            aria-label="صوت الالتقاط"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle('shutterSound');
            }}
            className="min-h-[52px] min-w-[56px] px-2 flex items-center justify-center focus:outline-none"
          >
            <div
              className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-200 ${
                settings.shutterSound ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-200 ${
                  settings.shutterSound ? '-translate-x-6' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>
      </div>

      {/* CARD: Smart Sensing & Auto Detection */}
      <div className="bg-white dark:bg-slate-900 rounded-[20px] p-5 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-2">
        <div className="flex items-center justify-between px-1 mb-3">
          <h2 className="text-sm font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
            الميزات الذكية والاستشعار
          </h2>
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-200/50 dark:border-emerald-800/40">
            <Sparkles className="w-3 h-3" />
            <span>استشعار تلقائي</span>
          </span>
        </div>

        {/* Toggle: Smart Auto-Torch */}
        <div
          onClick={() => handleToggle('smartTorch')}
          className="min-h-[52px] py-2 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-white block">
                الفلاش الذكي التلقائي
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                تشغيل الكشاف تلقائياً وبصمت في الأماكن المعتمة وإطفاؤه عند توفر الإضاءة
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.smartTorch}
            aria-label="الفلاش الذكي التلقائي"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle('smartTorch');
            }}
            className="min-h-[52px] min-w-[56px] px-2 flex items-center justify-center focus:outline-none"
          >
            <div
              className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-200 ${
                settings.smartTorch ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-200 ${
                  settings.smartTorch ? '-translate-x-6' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>

        {/* Toggle: Smart Shelf Zoom */}
        <div
          onClick={() => handleToggle('smartZoom')}
          className="min-h-[52px] py-2 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <ZoomIn className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-white block">
                التقريب الذكي للأرفف
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                استشعار بُعد الرف وتطبيق التقريب تلقائياً لتوضيح التفاصيل مع إتاحة التحكم اليدوي
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.smartZoom}
            aria-label="التقريب الذكي للأرفف"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle('smartZoom');
            }}
            className="min-h-[52px] min-w-[56px] px-2 flex items-center justify-center focus:outline-none"
          >
            <div
              className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-200 ${
                settings.smartZoom ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-200 ${
                  settings.smartZoom ? '-translate-x-6' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>

        {/* Toggle: Auto Analyze Queue */}
        <div
          onClick={() => handleToggle('autoAnalyzeQueue')}
          className="min-h-[52px] py-2 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-white block">
                التحليل التلقائي بالخلفية أثناء التصوير
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                بدء التحليل فوراً في الخلفية بمجرد التقاط الصورة وأثناء انتقالك للرف التالي
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.autoAnalyzeQueue}
            aria-label="التحليل التلقائي بالذكاء الاصطناعي"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle('autoAnalyzeQueue');
            }}
            className="min-h-[52px] min-w-[56px] px-2 flex items-center justify-center focus:outline-none"
          >
            <div
              className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-200 ${
                settings.autoAnalyzeQueue ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-200 ${
                  settings.autoAnalyzeQueue ? '-translate-x-6' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>

        {/* Toggle: Fast Analysis Mode */}
        <div
          onClick={() => handleToggle('fastAnalysisMode')}
          className="min-h-[52px] py-2 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-white block">
                وضع التحليل السريع الخفيف
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                إرسال صورة واحدة عند معرفة سعة الرف وتقليل البيانات بالتركيز على النواقص
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.fastAnalysisMode}
            aria-label="وضع التحليل السريع الخفيف"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle('fastAnalysisMode');
            }}
            className="min-h-[52px] min-w-[56px] px-2 flex items-center justify-center focus:outline-none"
          >
            <div
              className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-200 ${
                settings.fastAnalysisMode ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-200 ${
                  settings.fastAnalysisMode ? '-translate-x-6' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>

        {/* Toggle: Single-Shelf Automatic Focus Mode */}
        <div
          onClick={() => handleToggle('singleShelfFocusMode')}
          className="min-h-[52px] py-2 flex items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-white block">
                التركيز التلقائي على رف واحد فقط
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                عزل الرف الأوسط الرئيسي تلقائياً وتجاهل الأرفف العلوية والسفلية لتسريع التحليل ومنع التداخل
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.singleShelfFocusMode}
            aria-label="التركيز التلقائي على رف واحد فقط"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle('singleShelfFocusMode');
            }}
            className="min-h-[52px] min-w-[56px] px-2 flex items-center justify-center focus:outline-none"
          >
            <div
              className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-200 ${
                settings.singleShelfFocusMode ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-200 ${
                  settings.singleShelfFocusMode ? '-translate-x-6' : 'translate-x-0'
                }`}
              />
            </div>
          </button>
        </div>

        {/* Selector: Analysis Queue Pace */}
        <div className="pt-2 space-y-2">
          <div>
            <span className="text-sm font-bold text-slate-800 dark:text-white block">
              سرعة طابور التحليل
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              اختر التوازن المناسب بين السرعة القصوى وحماية حدود الاستخدام المجاني
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handlePaceModeChange('safe')}
              className={`min-h-[48px] px-2 rounded-[14px] text-xs font-bold border transition ${
                settings.analysisPaceMode === 'safe'
                  ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20'
                  : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
              }`}
            >
              آمن (4.5 ث)
            </button>
            <button
              type="button"
              onClick={() => handlePaceModeChange('fast')}
              className={`min-h-[48px] px-2 rounded-[14px] text-xs font-bold border transition ${
                settings.analysisPaceMode === 'fast'
                  ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20'
                  : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
              }`}
            >
              سريع (فوري)
            </button>
            <button
              type="button"
              onClick={() => handlePaceModeChange('parallel')}
              className={`min-h-[48px] px-2 rounded-[14px] text-xs font-bold border transition ${
                settings.analysisPaceMode === 'parallel'
                  ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20'
                  : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
              }`}
            >
              متوازي (2×)
            </button>
          </div>
        </div>
      </div>

      {/* CARD 2: Theme / Display */}
      <div className="bg-white dark:bg-slate-900 rounded-[20px] p-5 shadow-sm border border-slate-200/80 dark:border-slate-800">
        <h2 className="text-sm font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-3 px-1">
          مظهر التطبيق
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => handleThemeChange('light')}
            className={`min-h-[52px] rounded-[16px] text-xs font-bold flex items-center justify-center gap-1.5 border transition ${
              settings.theme === 'light'
                ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20'
                : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            }`}
          >
            <Sun className="w-4 h-4" />
            <span>فاتح</span>
          </button>
          <button
            type="button"
            onClick={() => handleThemeChange('dark')}
            className={`min-h-[52px] rounded-[16px] text-xs font-bold flex items-center justify-center gap-1.5 border transition ${
              settings.theme === 'dark'
                ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20'
                : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            }`}
          >
            <Moon className="w-4 h-4" />
            <span>داكن</span>
          </button>
          <button
            type="button"
            onClick={() => handleThemeChange('system')}
            className={`min-h-[52px] rounded-[16px] text-xs font-bold flex items-center justify-center gap-1.5 border transition ${
              settings.theme === 'system'
                ? 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20'
                : 'bg-[#F7F8FA] dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>تلقائي</span>
          </button>
        </div>
      </div>

      {/* CARD 3: Data Management & Persistence */}
      <div className="bg-white dark:bg-slate-900 rounded-[20px] p-5 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
            إدارة البيانات والتخزين المحلي
          </h2>
          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>IndexedDB + التخزين الدائم</span>
          </span>
        </div>

        <div className="space-y-3">
          {/* Export JSON button */}
          <button
            type="button"
            onClick={handleExport}
            className="min-h-[52px] w-full rounded-[16px] bg-[#F7F8FA] dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700/60 active:scale-[0.99] text-slate-800 dark:text-white font-bold text-sm flex items-center justify-between px-4 border border-slate-200 dark:border-slate-700 transition"
          >
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-emerald-500" />
              <span>تصدير نسخة احتياطية (JSON)</span>
            </div>
            <span className="text-xs text-slate-400">تنزيل ملف البيانات</span>
          </button>

          {/* Clear all data button */}
          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            className="min-h-[52px] w-full rounded-[16px] bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-900/30 active:scale-[0.99] text-red-600 dark:text-red-400 font-bold text-sm flex items-center justify-between px-4 border border-red-200 dark:border-red-900/40 transition"
          >
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5" />
              <span>مسح جميع البيانات</span>
            </div>
            <span className="text-xs text-red-400">حذف الجولات والصور</span>
          </button>
        </div>
      </div>

      {/* CARD 4: PWA Installation */}
      <div className="bg-white dark:bg-slate-900 rounded-[20px] p-5 shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-3">
        <h2 className="text-sm font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider px-1">
          تثبيت التطبيق على جهازك (PWA)
        </h2>

        {isInstalled ? (
          <div className="p-4 rounded-[16px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
            <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              التطبيق مثبت حالياً ويعمل في وضع التطبيق المستقل (Standalone PWA).
            </p>
          </div>
        ) : isInstallable ? (
          <button
            type="button"
            onClick={install}
            className="min-h-[52px] w-full rounded-[16px] bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition"
          >
            <Smartphone className="w-5 h-5" />
            <span>تثبيت تطبيق رفوف على الشاشة الرئيسية</span>
          </button>
        ) : isIOS ? (
          <div>
            <button
              type="button"
              onClick={() => setShowIOSGuide(true)}
              className="min-h-[52px] w-full rounded-[16px] bg-[#F7F8FA] dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-sm flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 transition"
            >
              <Smartphone className="w-5 h-5 text-emerald-500" />
              <span>تعليمات التثبيت لأجهزة iPhone / iPad</span>
            </button>
          </div>
        ) : (
          <div className="p-3 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Info className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>
              يمكنك تثبيت التطبيق من قائمة خيارات المتصفح بالنقر على "إضافة إلى الشاشة الرئيسية".
            </span>
          </div>
        )}
      </div>

      {/* CARD 5: Stage 2 Gemini Vision Readiness Info */}
      <div className="bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-950/40 dark:via-emerald-900/10 rounded-[20px] p-5 border border-emerald-500/20 space-y-2">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <Sparkles className="w-5 h-5" />
          <span className="font-bold text-sm">مهيأ للمرحلة 2: تكامل الذكاء الاصطناعي</span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          تم تصميم هيكلية تخزين الصور وضغطها خصيصاً للتوافق مع نماذج <strong>Gemini Vision API</strong> في
          المرحلة الثانية لتحليل نسبة فراغ الأرفف، والتعرف التلقائي على المنتجات الناقصة، وإصدار تنبيهات
          إعادة التعبئة الفورية لفرق المستودع.
        </p>
      </div>

      {/* Clear Data Confirmation Dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-[24px] p-6 shadow-2xl border border-slate-200 dark:border-slate-800 text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                هل أنت متأكد من مسح جميع البيانات؟
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                سيؤدي هذا الإجراء إلى حذف جميع الصور الملتقطة، والجولات المسجلة، وإعادة ضبط الإعدادات. لا يمكن
                التراجع عن هذه الخطوة.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={handleClearAll}
                className="min-h-[52px] bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white font-bold text-sm rounded-[16px] transition"
              >
                نعم، احذف الكل
              </button>
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="min-h-[52px] bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-sm rounded-[16px] hover:bg-slate-200 transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iOS Safari Guide Dialog */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-[24px] p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              تثبيت التطبيق على iOS (Safari)
            </h3>
            <ol className="text-xs text-slate-600 dark:text-slate-300 space-y-2 list-decimal list-inside leading-relaxed">
              <li>
                اضغط على زر <strong>المشاركة (Share)</strong> في أسفل شريط Safari.
              </li>
              <li>
                مرر للأسفل واضغط على <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.
              </li>
              <li>
                اضغط على <strong>إضافة (Add)</strong> في الزاوية العلوية.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="min-h-[52px] w-full rounded-[16px] bg-emerald-500 text-white font-bold text-sm mt-2 transition"
            >
              فهمت ذلك
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
