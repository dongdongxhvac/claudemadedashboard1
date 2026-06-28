// Receipt image normalization. Re-encode any browser-decodable image to a
// downscaled JPEG before upload, so:
//   * the OCR function always gets a vision-API-supported type (jpeg),
//   * large phone photos shrink under the 15 MB bucket cap and OCR fast,
//   * HEIC/HEIF (which most browsers can't decode) fails cleanly here with
//     a clear message rather than uploading something OCR can't read.
const MAX_DIM = 2200;       // longest side, px
const JPEG_QUALITY = 0.85;

export async function reencodeToJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('could not encode JPEG');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(
      'Could not read this image. If it is a HEIC photo, set the camera to "Most Compatible" (JPEG) or convert it first.',
    ));
    img.src = url;
  });
}
