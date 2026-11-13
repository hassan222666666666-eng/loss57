import React, { useState } from 'react';
import {
  X,
  Trash2,
  Award,
  Clock,
  ArrowRight,
  CheckSquare,
  Square,
  AlertTriangle,
  Camera,
  Edit3,
} from 'lucide-react';
import { PhotoRecord } from '../types';
import { PhotoDetailEditorModal } from './PhotoDetailEditorModal';
import { deleteMultiplePhotos, deleteLogEntriesByPhotoId } from '../services/db';

interface SessionGalleryModalProps {
  isOpen: boolean;
  photos: PhotoRecord[];
  sessionId: string;
  onClose: () => void;
  onDeletePhoto: (id: string) => Promise<void>;
  onUpdatePhoto: (photo: PhotoRecord) => Promise<void>;
  onRefreshPhotos: () => Promise<void>;
}

export const SessionGalleryModal: React.FC<SessionGalleryModalProps> = ({
  isOpen,
  photos,
  sessionId,
  onClose,
  onDeletePhoto,
  onUpdatePhoto,
  onRefreshPhotos,
}) => {
  // Modal states
  const [editingPhoto, setEditingPhoto] = useState<PhotoRecord | null>(null);
  const [isSelectMode, setIsSelectMode] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchDeleting, setIsBatchDeleting] = useState<boolean>(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState<boolean>(false);

  if (!isOpen) return null;

  // Toggle selection mode
  const handleToggleSelectMode = () => {
    if (isSelectMode) {
      setIsSelectMode(false);
      setSelectedIds(new Set());
    } else {
      setIsSelectMode(true);
    }
  };

  // Select / deselect individual photo in batch mode
  const handleToggleSelectPhoto = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all / deselect all
  const handleSelectAll = () => {
    if (selectedIds.size === photos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(photos.map((p) => p.id)));
    }
  };

  // Perform Batch Delete
  const handleConfirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsBatchDeleting(true);
    try {
      const idsToDelete = Array.from(selectedIds);
      await deleteMultiplePhotos(idsToDelete, sessionId);
      await Promise.all(idsToDelete.map((id) => deleteLogEntriesByPhotoId(id)));
      setSelectedIds(new Set());
      setIsSelectMode(false);
      setShowBatchDeleteConfirm(false);
      await onRefreshPhotos();
    } catch (err) {
      console.error('Failed to batch delete photos:', err);
    } finally {
      setIsBatchDeleting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200"
        dir="rtl"
      >
        <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200 dark:border-slate-800">
          {/* TOP HEADER */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                معرض صور الجولة الحالية
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {photos.length} {photos.length === 1 ? 'صورة مسجلة' : 'صور مسجلة'} · انقر للتعديل أو الحذف
              </p>
            </div>

            <div className="flex items-center gap-2">
              {photos.length > 0 && (
                <button
                  type="button"
                  onClick={handleToggleSelectMode}
                  className={`min-h-[46px] px-3.5 rounded-xl font-bold text-xs transition active:scale-95 border ${
                    isSelectMode
                      ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {isSelectMode ? 'إلغاء التحديد' : 'تحديد متعدد'}
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="min-h-[52px] min-w-[52px] rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center transition active:scale-95"
                aria-label="إغلاق المعرض"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* MULTI-SELECT BAR (when active) */}
          {isSelectMode && photos.length > 0 && (
            <div className="px-5 py-3 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-100 dark:border-emerald-900/40 flex items-center justify-between text-xs font-bold shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-emerald-700 dark:text-emerald-300 underline hover:opacity-80"
                >
                  {selectedIds.size === photos.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                </button>
                <span className="text-slate-400">·</span>
                <span className="text-slate-700 dark:text-slate-300">
                  تم تحديد {selectedIds.size} من {photos.length}
                </span>
              </div>

              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setShowBatchDeleteConfirm(true)}
                  className="min-h-[40px] px-3 bg-red-600 hover:bg-red-700 active:scale-95 text-white rounded-lg flex items-center gap-1.5 shadow-sm transition"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>حذف المحدد ({selectedIds.size})</span>
                </button>
              )}
            </div>
          )}

          {/* BATCH DELETE CONFIRMATION DIALOG */}
          {showBatchDeleteConfirm && (
            <div className="p-4 bg-red-50 dark:bg-red-950/60 border-b border-red-200 dark:border-red-900/60 shrink-0 space-y-3">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span className="text-xs sm:text-sm font-bold">
                  هل أنت متأكد من حذف {selectedIds.size} صورة دفعة واحدة؟ لا يمكن التراجع.
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleConfirmBatchDelete}
                  disabled={isBatchDeleting}
                  className="min-h-[46px] px-5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition active:scale-95"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>{isBatchDeleting ? 'جاري الحذف...' : 'نعم، احذف الصور المحددة'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowBatchDeleteConfirm(false)}
                  disabled={isBatchDeleting}
                  className="min-h-[46px] px-4 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl border border-slate-300 dark:border-slate-700 transition"
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}

          {/* PHOTOS GRID */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            {photos.length === 0 ? (
              <div className="text-center py-16 px-4">
                <div className="w-16 h-16 rounded-[22px] bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto mb-4">
                  <Camera className="w-8 h-8 opacity-60" />
                </div>
                <h3 className="text-base font-bold text-slate-800 dark:text-white">
                  لا توجد صور في هذه الجولة بعد
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto">
                  التقط صور أرفف السوبرماركت من شاشة الكاميرا لتظهر هنا وتتمكن من مراجعتها وتعديل سعتها أو حذفها.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {photos.map((photo) => {
                  const isSelected = selectedIds.has(photo.id);

                  return (
                    <div
                      key={photo.id}
                      onClick={() => {
                        if (isSelectMode) {
                          handleToggleSelectPhoto(photo.id, { stopPropagation: () => {} } as any);
                        } else {
                          setEditingPhoto(photo);
                        }
                      }}
                      className={`group relative rounded-[20px] overflow-hidden bg-slate-100 dark:bg-slate-800 border aspect-[4/3] cursor-pointer transition shadow-sm ${
                        isSelected
                          ? 'border-emerald-500 ring-2 ring-emerald-500/40'
                          : 'border-slate-200 dark:border-slate-700 hover:border-emerald-500'
                      }`}
                    >
                      <img
                        src={photo.dataUrl}
                        alt="معاينة الرف"
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      />

                      {/* Select Mode Checkbox */}
                      {isSelectMode && (
                        <div
                          className="absolute top-2 left-2 z-10"
                          onClick={(e) => handleToggleSelectPhoto(photo.id, e)}
                        >
                          {isSelected ? (
                            <div className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-md">
                              <CheckSquare className="w-5 h-5" />
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded-lg bg-black/60 backdrop-blur-sm text-white/90 border border-white/40 flex items-center justify-center shadow-md">
                              <Square className="w-5 h-5" />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Golden Reference & Analysis Status Badges */}
                      {photo.isGoldenReference && (
                        <span className="absolute top-2 right-2 bg-amber-500 text-white p-1.5 rounded-full shadow-md">
                          <Award className="w-3.5 h-3.5" />
                        </span>
                      )}

                      {!isSelectMode && (
                        <div className="absolute top-2 left-2 flex items-center gap-1">
                          {photo.analysisStatus === 'completed' ? (
                            <span className="bg-emerald-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow">
                              {photo.analysisResult?.products?.length || 0} منتج
                            </span>
                          ) : photo.analysisStatus === 'analyzing' ? (
                            <span className="bg-blue-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow animate-pulse">
                              جاري التحليل
                            </span>
                          ) : photo.analysisStatus === 'error' ? (
                            <span className="bg-red-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow">
                              فشل التحليل
                            </span>
                          ) : (
                            <span className="bg-amber-500/90 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              معلق
                            </span>
                          )}
                          <div className="opacity-0 group-hover:opacity-100 transition duration-200 bg-black/65 backdrop-blur-sm text-white p-1 rounded-lg shadow-md">
                            <Edit3 className="w-3 h-3" />
                          </div>
                        </div>
                      )}

                      {/* Bottom Info Pill */}
                      <div className="absolute bottom-2 inset-x-2 flex items-center justify-between pointer-events-none">
                        {photo.shelfCapacity ? (
                          <span className="bg-black/75 backdrop-blur-sm text-white text-[11px] font-bold px-2.5 py-0.5 rounded-md">
                            {photo.shelfCapacity} قطعة
                          </span>
                        ) : (
                          <span />
                        )}

                        {photo.aisle && (
                          <span className="bg-emerald-600/90 backdrop-blur-sm text-white text-[10px] font-semibold px-2 py-0.5 rounded-md truncate max-w-[90px]">
                            {photo.aisle}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* FOOTER */}
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-[#F7F8FA] dark:bg-slate-900/60 flex items-center justify-between shrink-0">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              💡 اضغط على أي صورة لتعديل سعتها، تدويرها، أو حذفها
            </span>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[52px] px-6 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold text-sm rounded-[16px] hover:opacity-90 active:scale-[0.98] transition"
            >
              العودة إلى الكاميرا
            </button>
          </div>
        </div>
      </div>

      {/* PHOTO DETAIL & EDIT MODAL */}
      {editingPhoto && (
        <PhotoDetailEditorModal
          isOpen={true}
          photo={editingPhoto}
          onClose={() => setEditingPhoto(null)}
          onSavePhoto={async (updated) => {
            await onUpdatePhoto(updated);
            setEditingPhoto(null);
            await onRefreshPhotos();
          }}
          onDeletePhoto={async (id) => {
            await onDeletePhoto(id);
            setEditingPhoto(null);
            await onRefreshPhotos();
          }}
        />
      )}
    </>
  );
};
