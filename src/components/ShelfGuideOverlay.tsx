import React from 'react';

interface ShelfGuideOverlayProps {
  isCapturing?: boolean;
  singleShelfFocus?: boolean;
}

export const ShelfGuideOverlay: React.FC<ShelfGuideOverlayProps> = ({
  isCapturing = false,
  singleShelfFocus = true,
}) => {
  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6 z-10">
      {/* 
        High-Performance Shelf Bounding Rectangle:
        Avoid heavy box-shadow 9999px which causes mobile GPU fill-rate throttling.
        Use clean hairline borders with smooth hardware-accelerated transforms.
      */}
      <div
        className={`relative w-full max-w-[360px] ${
          singleShelfFocus ? 'aspect-[16/10]' : 'aspect-[4/3]'
        } rounded-[24px] border-2 transition-all duration-150 ${
          isCapturing ? 'border-emerald-400 scale-[1.02]' : 'border-white/80'
        } bg-black/15 backdrop-brightness-95`}
      >
        {/* L-shaped corner markers (Hardware accelerated) */}
        {/* Top-Right (RTL start) */}
        <div className="absolute -top-1.5 -right-1.5 w-7 h-7 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
        {/* Top-Left */}
        <div className="absolute -top-1.5 -left-1.5 w-7 h-7 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
        {/* Bottom-Right */}
        <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />
        {/* Bottom-Left */}
        <div className="absolute -bottom-1.5 -left-1.5 w-7 h-7 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />

        {/* Shelf alignment horizontal guidelines */}
        <div className="absolute top-1/2 left-4 right-4 h-0.5 border-t border-dashed border-white/60" />
        <div className="absolute bottom-5 left-5 right-5 h-0.5 border-t-2 border-dashed border-emerald-400/90" />

        {/* Center alignment reticle */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border border-white/50 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-500/50" />
          </div>
        </div>

        {/* Framing guidance label at top */}
        <div className="absolute -top-10 inset-x-0 flex justify-center">
          <span className="text-white text-xs font-semibold px-3 py-1 rounded-full bg-slate-950/80 backdrop-blur-sm border border-emerald-400/30 shadow-sm whitespace-nowrap">
            {singleShelfFocus
              ? 'رف واحد تلقائياً — وجّه الإطار على الرف المطلوب'
              : 'قم بمحاذاة الرف داخل الإطار'}
          </span>
        </div>
      </div>
    </div>
  );
};
