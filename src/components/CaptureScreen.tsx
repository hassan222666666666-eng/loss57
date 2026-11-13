import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  Upload,
  Zap,
  ZapOff,
  RotateCcw,
  Layers,
  Award,
  PlusCircle,
  SwitchCamera,
  RefreshCw,
  AlertCircle,
  Play,
  Sparkles,
} from 'lucide-react';
import { AppSettings, PhotoRecord, RestockSession } from '../types';
import { ShelfGuideOverlay } from './ShelfGuideOverlay';
import { CapacityBottomSheet } from './CapacityBottomSheet';
import { SessionGalleryModal } from './SessionGalleryModal';
import { calculateTargetDimensions, formatPhotoCountLabel } from '../utils/imageUtils';
import { warmAudioContext, playShutterSound } from '../utils/sound';
import {
  savePhoto,
  getPhotosBySession,
  deletePhoto,
  deleteLogEntriesByPhotoId,
  updatePhoto,
  createSession,
  findOrCreateShelf,
  saveGoldenReference,
  updateShelfCapacity,
  getPendingPhotos,
  getErroredPhotos,
} from '../services/db';
import { analysisQueue, QueueProgressState } from '../services/analysisQueue';

interface CaptureScreenProps {
  settings: AppSettings;
  activeSession: RestockSession;
  onSessionUpdated: (session: RestockSession) => void;
  isActiveTab?: boolean;
}

export const CaptureScreen: React.FC<CaptureScreenProps> = ({
  settings,
  activeSession,
  onSessionUpdated,
  isActiveTab = true,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reusableCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Stream & Video state
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState<boolean>(false);
  const [cameraLoading, setCameraLoading] = useState<boolean>(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Controls state
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false);
  const [hasTorchSupport, setHasTorchSupport] = useState<boolean>(false);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [nextIsGoldenRef, setNextIsGoldenRef] = useState<boolean>(false);

  // Photos state for current session
  const [sessionPhotos, setSessionPhotos] = useState<PhotoRecord[]>([]);
  const [lastPhoto, setLastPhoto] = useState<PhotoRecord | null>(null);

  // Modals state
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);
  const [pendingCapacityPhoto, setPendingCapacityPhoto] = useState<PhotoRecord | null>(null);

  // Smart Sensing & Zoom state
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [hasHardwareZoom, setHasHardwareZoom] = useState<boolean>(false);
  const [minZoom, setMinZoom] = useState<number>(1);
  const [maxZoom, setMaxZoom] = useState<number>(3);
  const [isAutoZoomActive, setIsAutoZoomActive] = useState<boolean>(false);

  // Timestamps and counters for smart auto-engine
  const manualZoomOverrideUntil = useRef<number>(0);
  const manualTorchOverrideUntil = useRef<number>(0);
  const smartTorchTriggered = useRef<boolean>(false);
  const consecutiveDarkSamples = useRef<number>(0);
  const consecutiveBrightSamples = useRef<number>(0);
  const consecutiveFarSamples = useRef<number>(0);
  const consecutiveCloseSamples = useRef<number>(0);

  // Hidden offscreen canvas for real-time luminance & edge detection
  const samplingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Stage 2: Background Queue & Analysis State
  const [queueState, setQueueState] = useState<QueueProgressState>(analysisQueue.getState());
  const [pendingPhotosCount, setPendingPhotosCount] = useState<number>(0);
  const [erroredPhotosCount, setErroredPhotosCount] = useState<number>(0);

  const refreshPendingCount = useCallback(() => {
    Promise.all([getPendingPhotos(), getErroredPhotos()])
      .then(([pending, errored]) => {
        setPendingPhotosCount(pending.length);
        setErroredPhotosCount(errored.length);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    refreshPendingCount();
  }, [sessionPhotos.length, refreshPendingCount]);

  // Pre-warm audio on mount or first user tap
  useEffect(() => {
    warmAudioContext();
    const handleWarmup = () => {
      warmAudioContext();
      window.removeEventListener('touchstart', handleWarmup);
      window.removeEventListener('click', handleWarmup);
    };
    window.addEventListener('touchstart', handleWarmup, { once: true, passive: true });
    window.addEventListener('click', handleWarmup, { once: true, passive: true });
    return () => {
      window.removeEventListener('touchstart', handleWarmup);
      window.removeEventListener('click', handleWarmup);
    };
  }, []);

  // Load photos for active session
  const loadSessionPhotos = useCallback(async () => {
    try {
      const photos = await getPhotosBySession(activeSession.id);
      setSessionPhotos(photos);
      if (photos.length > 0) {
        setLastPhoto(photos[0]);
      } else {
        setLastPhoto(null);
      }
    } catch (err) {
      console.error('Failed to load session photos:', err);
    }
  }, [activeSession.id]);

  useEffect(() => {
    loadSessionPhotos();
  }, [loadSessionPhotos]);

  useEffect(() => {
    const unsub = analysisQueue.subscribe((st) => {
      setQueueState(st);
      refreshPendingCount();
      loadSessionPhotos();
    });
    refreshPendingCount();
    return unsub;
  }, [refreshPendingCount, loadSessionPhotos]);

  // Reliable Real Camera Starter
  const startCamera = useCallback(
    async (targetFacing: 'environment' | 'user' = facingMode) => {
      setCameraLoading(true);
      setCameraError(null);

      // If existing stream is already active with the requested facing mode, reuse it!
      if (streamRef.current && streamRef.current.active) {
        const currentTrack = streamRef.current.getVideoTracks()[0];
        if (currentTrack && currentTrack.readyState === 'live') {
          // Stream already running, just ensure video is playing
          if (videoRef.current) {
            videoRef.current.play().catch(() => {});
          }
          setCameraLoading(false);
          return;
        }
      }

      // Cleanly stop any stale stream before requesting new one
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setActiveStream(null);
      setIsVideoPlaying(false);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraLoading(false);
        setCameraError('المتصفح لا يدعم الوصول المباشر إلى الكاميرا. يمكنك استخدام زر استوديو الصور للرفع.');
        return;
      }

      // Universal Android & iOS camera constraints
      const constraintList: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: targetFacing },
          },
          audio: false,
        },
        {
          video: {
            facingMode: targetFacing,
          },
          audio: false,
        },
        {
          video: true,
          audio: false,
        },
      ];

      let stream: MediaStream | null = null;
      let lastErr: unknown = null;

      for (const constraints of constraintList) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!stream) {
        setCameraLoading(false);
        const isPermissionDenied =
          lastErr instanceof DOMException &&
          (lastErr.name === 'NotAllowedError' || lastErr.name === 'PermissionDeniedError');

        if (isPermissionDenied) {
          setCameraError('يرجى السماح للتطبيق بالوصول إلى الكاميرا لمسح أرفف السوبرماركت.');
        } else {
          setCameraError('تعذر فتح الكاميرا، يرجى النقر على زر "تشغيل الكاميرا" أدناه.');
        }
        return;
      }

      streamRef.current = stream;
      setActiveStream(stream);
      setCameraLoading(false);

      // Check torch and zoom support
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        try {
          const capabilities = (videoTrack.getCapabilities?.() as {
            torch?: boolean;
            zoom?: { min: number; max: number; step: number };
          }) || {};
          setHasTorchSupport(!!capabilities.torch);

          if (capabilities.zoom) {
            setHasHardwareZoom(true);
            setMinZoom(capabilities.zoom.min || 1);
            setMaxZoom(Math.max(capabilities.zoom.max || 3, 3));
          } else {
            setHasHardwareZoom(false);
            setMinZoom(1);
            setMaxZoom(3);
          }
        } catch {
          setHasTorchSupport(false);
          setHasHardwareZoom(false);
        }
      }
    },
    [facingMode]
  );

  // Attach stream to <video> element reliably with zero delay
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeStream) return;

    video.srcObject = activeStream;

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsVideoPlaying(true);
        })
        .catch((err) => {
          console.warn('Video play interrupted or waiting for user gesture:', err);
        });
    }
  }, [activeStream]);

  // Initial camera startup
  useEffect(() => {
    startCamera(facingMode);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [startCamera, facingMode]);

  // Switch Camera (Flip facing mode)
  const handleSwitchCamera = async () => {
    const newFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newFacing);
    await startCamera(newFacing);
  };

  // Smooth Zoom Controller (Hardware with Digital Zoom fallback)
  const applyZoom = useCallback(
    async (targetZoom: number, isManual = false) => {
      const clamped = Math.max(minZoom, Math.min(maxZoom, targetZoom));
      setZoomLevel(clamped);

      if (isManual) {
        manualZoomOverrideUntil.current = Date.now() + 8000;
        setIsAutoZoomActive(false);
      }

      if (streamRef.current && hasHardwareZoom) {
        const track = streamRef.current.getVideoTracks()[0];
        if (track) {
          try {
            await (track as unknown as {
              applyConstraints: (c: { advanced: Array<{ zoom: number }> }) => Promise<void>;
            }).applyConstraints({
              advanced: [{ zoom: clamped }],
            });
          } catch {
            // Hardware constraint failed, will fall back to digital zoom CSS scale
          }
        }
      }
    },
    [minZoom, maxZoom, hasHardwareZoom]
  );

  // Reliable Torch Control (with manual override support)
  const setTorchState = useCallback(
    async (enabled: boolean, isManual = false) => {
      if (isManual) {
        manualTorchOverrideUntil.current = Date.now() + 8000;
      }
      setTorchEnabled(enabled);

      if (!streamRef.current) return;
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;

      try {
        await (track as unknown as {
          applyConstraints: (c: { advanced: Array<{ torch: boolean }> }) => Promise<void>;
        }).applyConstraints({
          advanced: [{ torch: enabled }],
        });
      } catch (err) {
        console.warn('Torch constraint error:', err);
      }
    },
    []
  );

  // Toggle Torch (Manual click)
  const toggleTorch = async () => {
    await setTorchState(!torchEnabled, true);
  };

  // Force manual play on user tap if autoplay was blocked
  const handleManualVideoPlay = () => {
    if (videoRef.current) {
      videoRef.current
        .play()
        .then(() => setIsVideoPlaying(true))
        .catch(() => startCamera(facingMode));
    } else {
      startCamera(facingMode);
    }
  };

  // Instant Zero-Latency Image Processing & Storage
  const processAndSaveDataUrl = async (dataUrl: string, w = 1280, h = 720) => {
    // Stage 2: Look up shelf and auto-apply known capacity
    let knownCapacity: number | null = null;
    let targetShelfId: string | null = null;
    try {
      const shelf = await findOrCreateShelf();
      targetShelfId = shelf.id;
      if (shelf.fullCapacity) {
        knownCapacity = shelf.fullCapacity;
      }
    } catch (err) {
      console.warn('Shelf lookup error:', err);
    }

    const newPhoto: PhotoRecord = {
      id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      sessionId: activeSession.id,
      timestamp: Date.now(),
      dataUrl,
      width: w,
      height: h,
      shelfCapacity: knownCapacity,
      isGoldenReference: nextIsGoldenRef,
      analysisStatus: 'pending',
      shelfMatchId: targetShelfId,
    };

    // If nextIsGoldenRef is toggled, bind as full shelf reference
    if (nextIsGoldenRef && targetShelfId) {
      saveGoldenReference(targetShelfId, newPhoto.id, newPhoto.dataUrl, knownCapacity).catch(console.error);
    }

    // Update UI state immediately
    setSessionPhotos((prev) => {
      const next = [newPhoto, ...prev];
      onSessionUpdated({ ...activeSession, photoCount: next.length });
      return next;
    });
    setLastPhoto(newPhoto);
    setNextIsGoldenRef(false);

    // Save to IndexedDB cleanly before triggering analysis queue
    await savePhoto(newPhoto).catch((err) => console.error('Background save error:', err));
    refreshPendingCount();

    // Stop Asking for Capacity: if shelf already has known capacity, skip asking!
    if (settings.askShelfCapacity && !knownCapacity) {
      setPendingCapacityPhoto(newPhoto);
    }

    // Auto-trigger background queue processor immediately
    if (settings.autoAnalyzeQueue) {
      analysisQueue.processQueue();
    }
  };

  const processAndSaveImage = (
    source: HTMLVideoElement | HTMLImageElement,
    sourceW: number,
    sourceH: number,
    applyDigitalZoom = true
  ) => {
    const { width: targetW, height: targetH } = calculateTargetDimensions(
      sourceW,
      sourceH,
      settings.compressionMaxWidth || 1280
    );

    // Reusable canvas prevents garbage collection freezes on mobile
    if (!reusableCanvasRef.current) {
      reusableCanvasRef.current = document.createElement('canvas');
    }
    const canvas = reusableCanvasRef.current;
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Draw frame: apply digital zoom only to live camera frames, never to uploaded gallery photos
    if (applyDigitalZoom && !hasHardwareZoom && zoomLevel > 1) {
      const cropW = sourceW / zoomLevel;
      const cropH = sourceH / zoomLevel;
      const cropX = (sourceW - cropW) / 2;
      const cropY = (sourceH - cropH) / 2;
      ctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
    } else {
      ctx.drawImage(source, 0, 0, targetW, targetH);
    }

    // Encode JPEG synchronously before returning so multi-file uploads never overwrite the shared canvas
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', settings.compressionQuality || 0.8);
      processAndSaveDataUrl(dataUrl, targetW, targetH);
    } catch (err) {
      console.error('Frame encode error:', err);
    }
  };

  // Real-time Smart Sensing Engine (Ambient Light & Shelf Distance Detection)
  useEffect(() => {
    if (!isVideoPlaying || !isActiveTab) return;

    const intervalId = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return;

      // Initialize lightweight 64x36 offscreen sampling canvas
      if (!samplingCanvasRef.current) {
        samplingCanvasRef.current = document.createElement('canvas');
        samplingCanvasRef.current.width = 64;
        samplingCanvasRef.current.height = 36;
      }

      const canvas = samplingCanvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      // Draw downscaled frame (< 1ms)
      ctx.drawImage(video, 0, 0, 64, 36);
      let imgData: ImageData;
      try {
        imgData = ctx.getImageData(0, 0, 64, 36);
      } catch {
        return;
      }

      const data = imgData.data;

      // 1. Calculate Average Scene Luminance (REC. 601)
      let totalLuminance = 0;
      let sampleCount = 0;
      for (let i = 0; i < data.length; i += 8) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        totalLuminance += lum;
        sampleCount++;
      }
      const avgLuminance = sampleCount > 0 ? totalLuminance / sampleCount : 128;

      // 2. Smart Torch Logic (Darkness sensing with hysteresis)
      if (settings.smartTorch && Date.now() > manualTorchOverrideUntil.current) {
        if (avgLuminance < 48) {
          consecutiveDarkSamples.current++;
          consecutiveBrightSamples.current = 0;
          if (consecutiveDarkSamples.current >= 2 && !torchEnabled) {
            // Turn torch ON silently & immediately
            setTorchState(true, false);
            smartTorchTriggered.current = true;
          }
        } else if (avgLuminance > 82) {
          consecutiveBrightSamples.current++;
          consecutiveDarkSamples.current = 0;
          if (consecutiveBrightSamples.current >= 2 && torchEnabled && smartTorchTriggered.current) {
            // Turn torch OFF silently & immediately
            setTorchState(false, false);
            smartTorchTriggered.current = false;
          }
        }
      }

      // 3. Smart Shelf Distance & Zoom Logic
      // Analyze central 32x20 region for edge density & variance
      if (settings.smartZoom && Date.now() > manualZoomOverrideUntil.current) {
        let edgeSum = 0;
        let edgeSamples = 0;
        // Central box: x from 16 to 48, y from 8 to 28
        for (let y = 8; y < 28; y += 2) {
          for (let x = 16; x < 48; x += 2) {
            const idx = (y * 64 + x) * 4;
            const idxRight = (y * 64 + (x + 1)) * 4;
            const idxDown = ((y + 1) * 64 + x) * 4;

            const lCenter = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            const lRight = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];
            const lDown = 0.299 * data[idxDown] + 0.587 * data[idxDown + 1] + 0.114 * data[idxDown + 2];

            const diff = Math.abs(lCenter - lRight) + Math.abs(lCenter - lDown);
            edgeSum += diff;
            edgeSamples++;
          }
        }

        const avgEdge = edgeSamples > 0 ? edgeSum / edgeSamples : 0;

        // Distant shelf products have a specific fine-detail / lower macro-contrast signature
        const isFarShelf = avgEdge > 9 && avgEdge < 32 && avgLuminance > 22;
        const isCloseShelf = avgEdge >= 45 || avgEdge <= 6;

        if (isFarShelf) {
          consecutiveFarSamples.current++;
          consecutiveCloseSamples.current = 0;
          if (consecutiveFarSamples.current >= 3 && zoomLevel === 1) {
            // Auto zoom to 2x
            applyZoom(2, false);
            setIsAutoZoomActive(true);
          }
        } else if (isCloseShelf) {
          consecutiveCloseSamples.current++;
          consecutiveFarSamples.current = 0;
          if (consecutiveCloseSamples.current >= 3 && isAutoZoomActive && zoomLevel > 1) {
            // Revert back to 1x
            applyZoom(1, false);
            setIsAutoZoomActive(false);
          }
        }
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [
    isVideoPlaying,
    isActiveTab,
    settings.smartTorch,
    settings.smartZoom,
    torchEnabled,
    zoomLevel,
    isAutoZoomActive,
    setTorchState,
    applyZoom,
  ]);

  // Keep camera running smoothly when tab becomes active again
  useEffect(() => {
    if (isActiveTab) {
      if (videoRef.current && activeStream && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      } else if (!activeStream && !cameraLoading) {
        startCamera(facingMode);
      }
    }
  }, [isActiveTab, activeStream, cameraLoading, startCamera, facingMode]);

  // Ultra-Fast Shutter Snap Handler (0ms feedback)
  const handleShutterClick = () => {
    if (isCapturing) return;

    // 1. Instant tactile & audio feedback (0ms latency)
    if (settings.shutterSound) {
      playShutterSound();
    }
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(18);
      } catch {
        // Ignore if vibration disallowed
      }
    }

    // 2. Instant visual shutter flash (100ms)
    setIsCapturing(true);
    setTimeout(() => setIsCapturing(false), 100);

    const video = videoRef.current;
    if (isVideoPlaying && video && video.videoWidth > 0) {
      try {
        processAndSaveImage(video, video.videoWidth, video.videoHeight);
      } catch (err) {
        console.error('Capture from video failed:', err);
      }
    } else {
      // If camera is waiting or inactive, trigger gallery file picker
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }
  };

  // Gallery / File Upload Handler (opens mobile photo gallery)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const processFileViaReader = () => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            try {
              processAndSaveImage(img, img.naturalWidth, img.naturalHeight, false);
            } catch (err) {
              console.error('File process failed:', err);
            }
          };
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      };

      try {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            processAndSaveImage(img, img.naturalWidth, img.naturalHeight, false);
          } catch (err) {
            console.error('File process failed:', err);
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          processFileViaReader();
        };
        img.src = objectUrl;
      } catch {
        processFileViaReader();
      }
    });

    e.target.value = '';
  };

  // Capacity Bottom Sheet Handlers
  const handleConfirmCapacity = async (capacity: number | null) => {
    if (!pendingCapacityPhoto) return;
    const updated = { ...pendingCapacityPhoto, shelfCapacity: capacity };
    await updatePhoto(updated);
    if (capacity && pendingCapacityPhoto.shelfMatchId) {
      await updateShelfCapacity(pendingCapacityPhoto.shelfMatchId, capacity);
      if (pendingCapacityPhoto.isGoldenReference) {
        await saveGoldenReference(
          pendingCapacityPhoto.shelfMatchId,
          pendingCapacityPhoto.id,
          pendingCapacityPhoto.dataUrl,
          capacity
        );
      }
    }
    setSessionPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    if (lastPhoto?.id === updated.id) {
      setLastPhoto(updated);
    }
    setPendingCapacityPhoto(null);
  };

  const handleSkipCapacity = () => {
    setPendingCapacityPhoto(null);
  };

  // Gallery Handlers
  const handleDeletePhoto = async (id: string) => {
    await deletePhoto(id, activeSession.id);
    await deleteLogEntriesByPhotoId(id);
    const updated = sessionPhotos.filter((p) => p.id !== id);
    setSessionPhotos(updated);
    setLastPhoto(updated[0] || null);
    onSessionUpdated({
      ...activeSession,
      photoCount: Math.max(0, activeSession.photoCount - 1),
    });
  };

  const handleUpdatePhoto = async (photo: PhotoRecord) => {
    await updatePhoto(photo);
    setSessionPhotos((prev) => prev.map((p) => (p.id === photo.id ? photo : p)));
    if (lastPhoto?.id === photo.id) {
      setLastPhoto(photo);
    }
  };

  const handleRefreshGallery = async () => {
    await loadSessionPhotos();
    const photos = await getPhotosBySession(activeSession.id);
    onSessionUpdated({
      ...activeSession,
      photoCount: photos.length,
    });
  };

  const handleStartNewWalk = async () => {
    const newSess = await createSession();
    onSessionUpdated(newSess);
    setSessionPhotos([]);
    setLastPhoto(null);
  };

  return (
    <div className="relative w-full h-[calc(100vh-68px)] max-h-[100vh] bg-slate-950 overflow-hidden select-none">
      {/* 
        Hidden file input for Photo Gallery:
        - Notice: 'capture' attribute is OMITTED so mobile browsers (Android/iOS)
          open the device Photo Gallery (معرض الصور) instead of re-opening the camera.
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
        aria-label="اختيار صور من معرض الصور"
      />

      {/* 
        Hardware-Accelerated Video Surface:
        - transform: translateZ(0) locks into GPU compositor surface
        - willChange: transform prevents software rasterization
      */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          transform: !hasHardwareZoom && zoomLevel > 1 ? `scale(${zoomLevel}) translateZ(0)` : 'translateZ(0)',
          WebkitTransform: !hasHardwareZoom && zoomLevel > 1 ? `scale(${zoomLevel}) translateZ(0)` : 'translateZ(0)',
          willChange: 'transform',
          transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          transformOrigin: 'center center',
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            videoRef.current.play().catch(console.warn);
          }
        }}
        onPlaying={() => setIsVideoPlaying(true)}
        onError={() => setIsVideoPlaying(false)}
        className={`absolute inset-0 w-full h-full object-cover ${
          isVideoPlaying ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
        }`}
      />

      {/* Camera Viewfinder States (Shown only while camera is initializing or if access is blocked) */}
      {!isVideoPlaying && (
        <div className="absolute inset-0 z-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950">
          {cameraError ? (
            <div className="max-w-xs w-full space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400 mx-auto shadow-lg">
                <Camera className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100 mb-1">الكاميرا قيد الانتظار</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{cameraError}</p>
              </div>
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="min-h-[52px] w-full rounded-2xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>تشغيل الكاميرا</span>
                </button>
                <button
                  type="button"
                  onClick={handleSwitchCamera}
                  className="min-h-[48px] w-full rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-300 font-semibold text-xs flex items-center justify-center gap-2 border border-slate-800 transition"
                >
                  <SwitchCamera className="w-4 h-4 text-emerald-400" />
                  <span>تبديل إلى الكاميرا {facingMode === 'environment' ? 'الأمامية' : 'الخلفية'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400 animate-pulse">
                <Camera className="w-7 h-7" />
              </div>
              <span className="text-xs font-semibold text-slate-300">جاري تشغيل الكاميرا...</span>
            </div>
          )}
        </div>
      )}

      {/* Shelf Framing Guide Rectangle */}
      <ShelfGuideOverlay
        isCapturing={isCapturing}
        singleShelfFocus={settings.singleShelfFocusMode !== false}
      />

      {/* Shutter Flash Animation */}
      {isCapturing && (
        <div className="absolute inset-0 bg-white pointer-events-none z-30 animate-out fade-out duration-200" />
      )}

      {/* TOP FLOATING CONTROLS */}
      <div className="absolute top-0 inset-x-0 p-4 pt-5 z-20 flex items-center justify-between pointer-events-none">
        {/* Session photo counter badge */}
        <div className="pointer-events-auto flex items-center gap-2">
          <div className="min-h-[46px] px-4 rounded-full bg-black/65 backdrop-blur-md border border-white/20 text-white flex items-center gap-2 shadow-lg">
            <Layers className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs font-bold whitespace-nowrap">
              {formatPhotoCountLabel(sessionPhotos.length)}
            </span>
          </div>

          {/* New session trigger button */}
          <button
            type="button"
            onClick={handleStartNewWalk}
            title="بدء جولة تفقد جديدة"
            aria-label="بدء جولة تفقد جديدة"
            className="min-h-[46px] min-w-[46px] rounded-full bg-black/65 backdrop-blur-md border border-white/20 text-white hover:text-emerald-400 flex items-center justify-center shadow-lg active:scale-95 transition"
          >
            <PlusCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Action icons: Switch Camera, Golden Ref, Torch */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* Camera Flip / Switch Camera Button */}
          <button
            type="button"
            onClick={handleSwitchCamera}
            title="تبديل الكاميرا (الخلفية / الأمامية)"
            aria-label="تبديل الكاميرا"
            className="min-h-[46px] min-w-[46px] rounded-full bg-black/65 backdrop-blur-md border border-white/20 text-white hover:text-emerald-400 flex items-center justify-center shadow-lg active:scale-95 transition"
          >
            <SwitchCamera className="w-5 h-5" />
          </button>

          {/* Golden reference indicator / toggle (if enabled in settings) */}
          {settings.useGoldenReference && (
            <button
              type="button"
              onClick={() => setNextIsGoldenRef(!nextIsGoldenRef)}
              title={
                nextIsGoldenRef
                  ? 'حفظ كصورة مرجعية للرف الممتلئ (مفعّل)'
                  : 'حفظ كصورة مرجعية للرف الممتلئ'
              }
              aria-label="حفظ كصورة مرجعية للرف الممتلئ"
              className={`min-h-[46px] min-w-[46px] rounded-full backdrop-blur-md border flex items-center justify-center shadow-lg active:scale-95 transition ${
                nextIsGoldenRef
                  ? 'bg-amber-500 text-white border-amber-300 ring-2 ring-amber-400/50 px-3 gap-1.5'
                  : 'bg-black/65 text-white/80 border-white/20 hover:text-white'
              }`}
            >
              <Award className="w-5 h-5 shrink-0" />
              {nextIsGoldenRef && (
                <span className="text-[11px] font-bold whitespace-nowrap">مرجع ممتلئ</span>
              )}
            </button>
          )}

          {/* Torch toggle with Smart Auto Indicator */}
          <div className="relative">
            <button
              type="button"
              onClick={toggleTorch}
              title={
                torchEnabled
                  ? 'إطفاء الفلاش'
                  : settings.smartTorch
                  ? 'تشغيل الفلاش يدوياً (الفلاش الذكي مفعّل)'
                  : 'تشغيل الفلاش'
              }
              aria-label="تبديل الفلاش"
              className={`min-h-[46px] min-w-[46px] rounded-full backdrop-blur-md border flex items-center justify-center shadow-lg active:scale-95 transition ${
                torchEnabled
                  ? 'bg-amber-400 text-slate-950 border-amber-300 ring-2 ring-amber-300/40 shadow-amber-400/20'
                  : 'bg-black/65 text-white border-white/20 hover:text-amber-300'
              }`}
            >
              {torchEnabled ? <Zap className="w-5 h-5 fill-current" /> : <ZapOff className="w-5 h-5" />}
            </button>
            {settings.smartTorch && (
              <span
                title="الفلاش الذكي مفعّل"
                className="absolute -top-1 -right-1 px-1.5 h-4 rounded-full bg-emerald-500 text-[9px] font-black text-white flex items-center justify-center shadow pointer-events-none ring-1 ring-slate-950"
              >
                ذكي
              </span>
            )}
          </div>
        </div>
      </div>

      {/* FLOATING QUEUE STATUS & PENDING / ERRORED TRIGGER BUTTON */}
      {(queueState.isProcessing ||
        pendingPhotosCount > 0 ||
        erroredPhotosCount > 0 ||
        Boolean(queueState.message)) && (
        <div className="absolute top-20 inset-x-0 px-4 z-20 flex flex-col items-center gap-1.5 pointer-events-none animate-in fade-in">
          {queueState.isProcessing ? (
            <div className="pointer-events-auto px-4 py-2 rounded-full bg-black/80 backdrop-blur-md border border-emerald-500/50 text-white text-xs font-bold flex items-center gap-2 shadow-xl animate-pulse">
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
              <span>{queueState.message}</span>
            </div>
          ) : (
            <>
              {queueState.message && (
                <div className="pointer-events-auto px-4 py-1.5 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-lg">
                  {queueState.message}
                </div>
              )}
              {pendingPhotosCount > 0 && (
                <button
                  type="button"
                  onClick={() => analysisQueue.processQueue()}
                  className="pointer-events-auto px-4 py-2 rounded-full bg-emerald-500/95 hover:bg-emerald-600 backdrop-blur-md text-white text-xs font-bold flex items-center gap-2 shadow-xl active:scale-95 transition"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                  <span>تحليل الصور المعلقة الآن ({pendingPhotosCount})</span>
                </button>
              )}
              {erroredPhotosCount > 0 && (
                <button
                  type="button"
                  onClick={() => analysisQueue.processQueue(true)}
                  className="pointer-events-auto px-4 py-2 rounded-full bg-red-600/95 hover:bg-red-700 backdrop-blur-md text-white text-xs font-bold flex items-center gap-2 shadow-xl active:scale-95 transition"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-white shrink-0" />
                  <span>إعادة تحليل الصور المتعثرة ({erroredPhotosCount})</span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* FLOATING ZOOM CONTROL BAR */}
      <div className="absolute bottom-24 inset-x-0 z-20 flex flex-col items-center pointer-events-none gap-1.5">
        {/* Subtle Auto-Zoom indicator badge if active */}
        {isAutoZoomActive && zoomLevel > 1 && (
          <div className="pointer-events-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/75 backdrop-blur-md border border-emerald-500/50 text-emerald-400 text-[11px] font-bold shadow-lg animate-in fade-in duration-200">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
            <span>تقريب ذكي تلقائي ({zoomLevel}x)</span>
          </div>
        )}

        {/* Quick Zoom Buttons: 1x, 2x, 3x */}
        <div className="pointer-events-auto flex items-center gap-1.5 p-1 rounded-full bg-black/65 backdrop-blur-md border border-white/20 shadow-xl">
          {[1, 2, 3].map((level) => {
            const isSelected = Math.abs(zoomLevel - level) < 0.2;
            return (
              <button
                key={level}
                type="button"
                onClick={() => applyZoom(level, true)}
                className={`min-h-[38px] min-w-[42px] px-3 rounded-full text-xs font-bold transition-all duration-200 flex items-center justify-center ${
                  isSelected
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30 scale-105'
                    : 'text-white/80 hover:text-white hover:bg-white/10 active:scale-95'
                }`}
                aria-label={`تقريب ${level}x`}
              >
                {level}x
              </button>
            );
          })}
        </div>
      </div>

      {/* BOTTOM CONTROLS BAR (Ergonomic One-Handed Thumb Zone) */}
      <div className="absolute bottom-4 inset-x-0 px-6 z-20 flex items-center justify-around pointer-events-none">
        {/* Left: Gallery Thumbnail (52px rounded) */}
        <div className="pointer-events-auto flex flex-col items-center">
          <button
            type="button"
            onClick={() => setIsGalleryOpen(true)}
            aria-label="فتح معرض صور الجولة"
            className="w-[52px] h-[52px] rounded-[18px] overflow-hidden bg-black/70 backdrop-blur-md border-2 border-white/80 shadow-xl flex items-center justify-center group active:scale-95 transition"
          >
            {lastPhoto ? (
              <img
                src={lastPhoto.dataUrl}
                alt="آخر صورة تم التقاطها"
                className="w-full h-full object-cover group-hover:scale-110 transition duration-200"
              />
            ) : (
              <Layers className="w-5 h-5 text-white/70" />
            )}
          </button>
          <span className="text-[11px] font-bold text-white/90 drop-shadow mt-1">صور الجولة</span>
        </div>

        {/* Center: Large 72px Emerald Shutter Button */}
        <div className="pointer-events-auto flex flex-col items-center">
          <button
            type="button"
            onClick={handleShutterClick}
            aria-label="التقاط صورة للرف"
            className="w-[72px] h-[72px] rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-90 text-white shadow-2xl shadow-emerald-500/50 flex items-center justify-center ring-4 ring-white/30 transition-transform duration-150"
          >
            <div className="w-[60px] h-[60px] rounded-full border-2 border-white/70 flex items-center justify-center">
              <Camera className="w-7 h-7 stroke-[2.2]" />
            </div>
          </button>
          <span className="text-[11px] font-bold text-white/90 drop-shadow mt-1">التقاط</span>
        </div>

        {/* Right: Device Photo Gallery Upload Button (52px) */}
        <div className="pointer-events-auto flex flex-col items-center">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="فتح معرض صور الهاتف لاختيار صورة"
            className="w-[52px] h-[52px] rounded-[18px] bg-black/70 backdrop-blur-md border border-white/40 text-white flex items-center justify-center shadow-xl active:scale-95 transition"
          >
            <Upload className="w-5 h-5" />
          </button>
          <span className="text-[11px] font-bold text-white/90 drop-shadow mt-1">استوديو الصور</span>
        </div>
      </div>

      {/* Slide-up Shelf Capacity Bottom Sheet */}
      <CapacityBottomSheet
        isOpen={!!pendingCapacityPhoto}
        photoThumbnail={pendingCapacityPhoto?.dataUrl}
        onConfirm={handleConfirmCapacity}
        onSkip={handleSkipCapacity}
      />

      {/* Session Gallery Modal */}
      <SessionGalleryModal
        isOpen={isGalleryOpen}
        photos={sessionPhotos}
        sessionId={activeSession.id}
        onClose={() => setIsGalleryOpen(false)}
        onDeletePhoto={handleDeletePhoto}
        onUpdatePhoto={handleUpdatePhoto}
        onRefreshPhotos={handleRefreshGallery}
      />
    </div>
  );
};
