import { useEffect, useState, useCallback } from 'react';
import { AppSettings, DEFAULT_SETTINGS, RestockSession } from './types';
import {
  initDB,
  getSettings,
  getActiveSession,
  requestStoragePersistence,
  recoverStuckAnalyzingPhotos,
} from './services/db';
import { analysisQueue } from './services/analysisQueue';
import { CaptureScreen } from './components/CaptureScreen';
import { LogScreen } from './components/LogScreen';
import { StatsScreen } from './components/StatsScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { BottomNav, TabKey } from './components/BottomNav';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('capture');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeSession, setActiveSession] = useState<RestockSession | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Initialize DB, settings, session, and storage persistence
  const initializeApp = useCallback(async () => {
    try {
      await initDB();
      // Request persistent storage on Android
      await requestStoragePersistence();
      await recoverStuckAnalyzingPhotos();

      const loadedSettings = await getSettings();
      setSettings(loadedSettings);

      // Apply initial theme
      applyTheme(loadedSettings.theme);

      const session = await getActiveSession();
      setActiveSession(session);

      if (loadedSettings.autoAnalyzeQueue) {
        analysisQueue.processQueue();
      }
    } catch (err) {
      console.error('Initialization error:', err);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  const applyTheme = (theme: 'system' | 'light' | 'dark') => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (theme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  };

  const handleSettingsChange = (newSettings: AppSettings) => {
    setSettings(newSettings);
    applyTheme(newSettings.theme);
  };

  const handleSessionUpdated = (updatedSession: RestockSession) => {
    setActiveSession(updatedSession);
  };

  const handleDataCleared = async () => {
    const freshSession = await getActiveSession();
    setActiveSession(freshSession);
    const freshSettings = await getSettings();
    setSettings(freshSettings);
  };

  if (isInitializing || !activeSession) {
    return (
      <div
        className="min-h-screen w-full flex flex-col items-center justify-center bg-[#F7F8FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100 p-6"
        dir="rtl"
      >
        <div className="w-16 h-16 rounded-[22px] bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30 animate-pulse mb-4">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M3 7h18M3 12h18M3 17h18" />
          </svg>
        </div>
        <h2 className="text-xl font-black text-slate-800 dark:text-white">رفوف</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">جاري تجهيز بيئة العمل والتخزين المحلي...</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#F7F8FA] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-white"
      dir="rtl"
    >
      {/* Top Mobile Brand Bar (Visible on Log, Stats, and Settings tabs) */}
      {activeTab !== 'capture' && (
        <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center text-white font-bold text-sm shadow-sm">
              ر
            </div>
            <span className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
              رفوف
            </span>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/50 dark:border-emerald-800/40">
              إدارة تعبئة الأرفف
            </span>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {activeSession.name.split('(')[0]}
          </div>
        </header>
      )}

      {/* Main Tab Views */}
      <main className="flex-1 w-full overflow-x-hidden">
        {/* Keep CaptureScreen persistently mounted so camera stream stays active across tab switches */}
        <div className={activeTab === 'capture' ? 'block' : 'hidden'}>
          <CaptureScreen
            settings={settings}
            activeSession={activeSession}
            onSessionUpdated={handleSessionUpdated}
            isActiveTab={activeTab === 'capture'}
          />
        </div>
        {activeTab === 'log' && <LogScreen />}
        {activeTab === 'stats' && <StatsScreen />}
        {activeTab === 'settings' && (
          <SettingsScreen
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onDataCleared={handleDataCleared}
          />
        )}
      </main>

      {/* Fixed Bottom Navigation Bar (4 tabs, 52px+ targets) */}
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
