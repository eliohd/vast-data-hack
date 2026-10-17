// Frame capture helpers. The pure maths is unit-tested; the DOM part stays thin.

export interface Size {
  width: number;
  height: number;
}

/** Scales `size` down (never up) so its longest side is at most `maxSide`. */
export function fitWithin(size: Size, maxSide: number): Size {
  const longest = Math.max(size.width, size.height);
  if (longest <= maxSide || longest === 0) return { ...size };
  const scale = maxSide / longest;
  return {
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  };
}

/** Approximate decoded byte size of a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const base64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Draws the current video frame onto `canvas`, downscaled to `maxSide`, and returns a JPEG
 * data URL. Returns null until the video has real dimensions.
 */
export function captureJpeg(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxSide = 640,
  quality = 0.7,
): { image: string; width: number; height: number } | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const { width, height } = fitWithin(
    { width: video.videoWidth, height: video.videoHeight },
    maxSide,
  );
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return { image: canvas.toDataURL('image/jpeg', quality), width, height };
}

/** Picks the first MediaRecorder mime type this browser supports (iOS → mp4, Chrome → webm). */
export function pickRecorderMimeType(
  isSupported: (type: string) => boolean = (t) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
): string | undefined {
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((type) => isSupported(type));
}
