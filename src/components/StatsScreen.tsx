import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  Layers,
  Award,
  CheckCircle,
  Sparkles,
  Package,
  Calendar,
} from 'lucide-react';
import { PhotoRecord, RestockSession, ConsumptionHistoryRecord, LogEntry } from '../types';
import {
  getAllPhotos,
  getAllSessions,
  getAllConsumptionHistory,
  getAllLogEntries,
} from '../services/db';

export const StatsScreen: React.FC = () => {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [sessions, setSessions] = useState<RestockSession[]>([]);
  const [history, setHistory] = useState<ConsumptionHistoryRecord[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const [allP, allS, allH, allL] = await Promise.all([
          getAllPhotos(),
          getAllSessions(),
          getAllConsumptionHistory(),
          getAllLogEntries(),
        ]);
        setPhotos(allP);
        setSessions(allS);
        setHistory(allH);
        setLogEntries(allL);
      } catch (err) {
        console.error('Failed to load stats data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  const totalPhotos = photos.length;
  const totalSessions = sessions.length;
  const goldenCount = photos.filter((p) => p.isGoldenReference).length;
  const analyzedPhotosCount = photos.filter((p) => p.analysisStatus === 'completed').length;
  const photosWithCapacity = photos.filter((p) => p.shelfCapacity !== null);
  const totalCapacitySum = photosWithCapacity.reduce(
    (sum, p) => sum + (p.shelfCapacity || 0),
    0
  );
  const avgCapacity =
    photosWithCapacity.length > 0
      ? Math.round(totalCapacitySum / photosWithCapacity.length)
      : 0;

  // Top depleted products from consumption_history
  const topDepleted = Object.values(
    history.reduce<Record<string, { name: string; missing: number; avgRatio: number; count: number }>>(
      (acc, rec) => {
        const key = rec.productName.trim();
        if (!acc[key]) {
          acc[key] = { name: key, missing: 0, avgRatio: 0, count: 0 };
        }
        acc[key].missing += rec.missingUnits;
        acc[key].avgRatio += rec.restockRatio;
        acc[key].count += 1;
        return acc;
      },
      {}
    )
  )
    .map((item) => ({ ...item, avgRatio: item.count > 0 ? item.avgRatio / item.count : 0 }))
    .sort((a, b) => b.missing - a.missing)
    .slice(0, 5);

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-6 pb-28 space-y-6" dir="rtl">
      {/* Header */}
      <div className="px-2">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
          لوحة الإحصائيات والمؤشرات
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          مؤشرات تغطية الأرفف وسرعة التوثيق عبر الجولات
        </p>
      </div>

      {/* Stage 4 Roadmap Banner */}
      <div className="rounded-[20px] bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent dark:from-emerald-950/40 p-4 border border-emerald-500/20 flex items-start gap-3">
        <div className="w-10 h-10 rounded-[14px] bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 block mb-0.5">
            المرحلة 4: لوحة تحليلات كفاءة إعادة التعبئة وسرعة نفاد المخزون (قريباً)
          </span>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            ستتضمن المرحلة 4 تقارير زمنية متقدمة لسرعة نفاد السلع في ساعات الذروة، ونسب الأرفف الفارغة
            حسب الممر، وربطها بنظام إدارة المخزون المركزي (ERP).
          </p>
        </div>
      </div>

      {/* 4 Top KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Card 1: Total Photos */}
        <div className="bg-white dark:bg-slate-900 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              إجمالي الصور
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
            {totalPhotos}
          </div>
          <div className="text-[11px] text-slate-400 font-medium">أرفف تم توثيقها بالكامل</div>
        </div>

        {/* Card 2: Total Sessions */}
        <div className="bg-white dark:bg-slate-900 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              الجولات الميدانية
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
            {totalSessions}
          </div>
          <div className="text-[11px] text-slate-400 font-medium">جولات تفقد مسجلة محلياً</div>
        </div>

        {/* Card 3: Avg Shelf Capacity */}
        <div className="bg-white dark:bg-slate-900 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              متوسط سعة الرف
            </span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
            {avgCapacity > 0 ? `${avgCapacity} قطعة` : '—'}
          </div>
          <div className="text-[11px] text-slate-400 font-medium">للأرفف المحددة استيعابياً</div>
        </div>

        {/* Card 4: Golden References */}
        <div className="bg-white dark:bg-slate-900 rounded-[20px] p-4 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              الصور المرجعية
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
            {goldenCount}
          </div>
          <div className="text-[11px] text-slate-400 font-medium">نماذج الرفوف الممتلئة</div>
        </div>
      </div>

      {/* Capacity & Restock Readiness Bars */}
      <div className="bg-white dark:bg-slate-900 rounded-[20px] p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-800 dark:text-white">
          جاهزية بيانات الأرفف للتحليل الذكي
        </h3>

        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              <span>نسبة الأرفف المحددة السعة</span>
              <span className="tabular-nums">
                {totalPhotos > 0
                  ? Math.round((photosWithCapacity.length / totalPhotos) * 100)
                  : 0}
                %
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{
                  width: `${
                    totalPhotos > 0
                      ? (photosWithCapacity.length / totalPhotos) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              <span>نسبة توثيق الصور المرجعية الذهبية</span>
              <span className="tabular-nums">
                {totalPhotos > 0 ? Math.round((goldenCount / totalPhotos) * 100) : 0}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-500"
                style={{
                  width: `${totalPhotos > 0 ? (goldenCount / totalPhotos) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              <span>نسبة الصور المحللة بـ Gemini Vision</span>
              <span className="tabular-nums">
                {totalPhotos > 0 ? Math.round((analyzedPhotosCount / totalPhotos) * 100) : 0}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{
                  width: `${totalPhotos > 0 ? (analyzedPhotosCount / totalPhotos) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Top Depleted Products from Consumption History */}
      {!loading && topDepleted.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-[20px] p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span>أكثر الأصناف استهلاكاً ونقصاً (سجل الاستهلاك)</span>
            </h3>
            <span className="text-[11px] font-semibold text-slate-400">
              {logEntries.length} سجل
            </span>
          </div>

          <div className="space-y-2.5">
            {topDepleted.map((item) => (
              <div key={item.name} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                    {item.name}
                  </span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
                    {item.missing} قطعة ناقصة
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${Math.min(100, Math.round(item.avgRatio * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
