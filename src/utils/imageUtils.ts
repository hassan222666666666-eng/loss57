/**
 * Pure image and formatting utility functions for Supermarket Shelf Restock PWA
 */

export function calculateTargetDimensions(
  origW: number,
  origH: number,
  maxDim: number = 1280
): { width: number; height: number } {
  if (origW <= 0 || origH <= 0 || maxDim <= 0) {
    return { width: Math.max(1, Math.round(origW)), height: Math.max(1, Math.round(origH)) };
  }

  if (origW <= maxDim && origH <= maxDim) {
    return { width: Math.round(origW), height: Math.round(origH) };
  }

  const aspectRatio = origW / origH;
  if (origW >= origH) {
    const width = maxDim;
    const height = Math.round(maxDim / aspectRatio);
    return { width, height };
  } else {
    const height = maxDim;
    const width = Math.round(maxDim * aspectRatio);
    return { width, height };
  }
}

export function validateShelfCapacity(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = typeof val === 'number' ? val : parseInt(String(val).trim(), 10);
  if (isNaN(num) || num <= 0 || num > 5000) return null;
  return Math.floor(num);
}

/**
 * Proper Arabic pluralization for photo count:
 * 0: لم يتم التقاط صور
 * 1: تم التقاط: صورة واحدة
 * 2: تم التقاط: صورتان
 * 3-10: تم التقاط: X صور
 * 11+: تم التقاط: X صورة
 */
export function formatPhotoCountLabel(count: number): string {
  if (count <= 0) return 'لم يتم التقاط صور بعد';
  if (count === 1) return 'تم التقاط: صورة واحدة';
  if (count === 2) return 'تم التقاط: صورتان';
  if (count >= 3 && count <= 10) return `تم التقاط: ${count} صور`;
  return `تم التقاط: ${count} صورة`;
}

export function formatArabicDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('ar-IQ', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

export function generateSessionName(date: Date = new Date()): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `جولة تفقد الأرفف (${day}/${month} - ${hours}:${minutes})`;
}

/**
 * Rotates an image dataUrl by specified degrees (e.g. 90, 180, 270)
 * Returns the rotated dataUrl along with the new dimensions.
 */
export function rotateImage(
  dataUrl: string,
  degrees: number = 90
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve({ dataUrl, width: 0, height: 0 });
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
          return;
        }

        const normalizedAngle = ((degrees % 360) + 360) % 360;
        const swapDimensions = normalizedAngle === 90 || normalizedAngle === 270;

        const targetW = swapDimensions ? img.naturalHeight : img.naturalWidth;
        const targetH = swapDimensions ? img.naturalWidth : img.naturalHeight;

        canvas.width = targetW;
        canvas.height = targetH;

        ctx.save();
        ctx.translate(targetW / 2, targetH / 2);
        ctx.rotate((normalizedAngle * Math.PI) / 180);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        ctx.restore();

        const newUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({
          dataUrl: newUrl,
          width: targetW,
          height: targetH,
        });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
}

/**
 * Applies brightness and contrast adjustments to an image dataUrl
 */
export function adjustImageBrightnessContrast(
  dataUrl: string,
  brightnessPercent: number = 115,
  contrastPercent: number = 110
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve(dataUrl);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.filter = `brightness(${brightnessPercent}%) contrast(${contrastPercent}%)`;
        ctx.drawImage(img, 0, 0);
        const enhancedUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(enhancedUrl);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
}

/**
 * Downscales an image dataUrl to a lighter resolution for fast Gemini Vision upload
 * without altering the original stored photo in IndexedDB.
 */
export function downscaleImageForAnalysis(
  dataUrl: string,
  maxDim: number = 800,
  quality: number = 0.72
): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve(dataUrl);
      return;
    }

    const img = new Image();
    img.onload = () => {
      try {
        const origW = img.naturalWidth;
        const origH = img.naturalHeight;
        if (origW <= maxDim && origH <= maxDim) {
          resolve(dataUrl);
          return;
        }
        const { width, height } = calculateTargetDimensions(origW, origH, maxDim);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}


