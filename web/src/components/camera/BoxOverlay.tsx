import { useEffect, useRef } from 'react';
import type { Box } from '@/lib/protocol';

interface Props {
  boxes: Box[];
  /** Intrinsic size of the analysed frame, used to map object-contain letterboxing. */
  frame: { width: number; height: number } | null;
}

/** Draws normalised boxes over an object-contain <video> that fills the same parent. */
export function BoxOverlay({ boxes, frame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!frame || boxes.length === 0) return;

    // Where object-contain actually draws the frame inside the element.
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
    const drawnW = frame.width * scale;
    const drawnH = frame.height * scale;
    const offsetX = (rect.width - drawnW) / 2;
    const offsetY = (rect.height - drawnH) / 2;

    ctx.lineWidth = 2;
    ctx.font = '12px Geist Variable, sans-serif';
    for (const box of boxes) {
      const x = offsetX + box.x * drawnW;
      const y = offsetY + box.y * drawnH;
      const w = box.w * drawnW;
      const h = box.h * drawnH;
      ctx.strokeStyle = '#22c55e';
      ctx.strokeRect(x, y, w, h);
      const label = `${box.label} ${Math.round(box.confidence * 100)}%`;
      const textW = ctx.measureText(label).width + 8;
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(x, Math.max(0, y - 18), textW, 18);
      ctx.fillStyle = '#052e16';
      ctx.fillText(label, x + 4, Math.max(12, y - 5));
    }
  }, [boxes, frame]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" />;
}
