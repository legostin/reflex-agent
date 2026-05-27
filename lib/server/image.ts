import "server-only";
import sharp from "sharp";
import type { ImageProcessing } from "@/lib/settings/schema";

export interface ProcessedImage {
  buf: Buffer;
  mime: string;
  /** New filename extension (with leading dot), e.g. `.jpg`. */
  ext: string;
  width?: number;
  height?: number;
}

/**
 * Resize + recompress an image according to the user's settings. Returns
 * `null` when the input shouldn't be touched (SVG, animated GIF, unknown
 * format) so the caller can store the original bytes.
 */
export async function processImage(
  buf: Buffer,
  mime: string,
  cfg: ImageProcessing,
): Promise<ProcessedImage | null> {
  if (!cfg.enabled) return null;
  // Skip vector + animated images: sharp would mangle them.
  if (mime === "image/svg+xml") return null;
  let pipeline = sharp(buf, { failOn: "none", animated: false });
  let meta: sharp.Metadata;
  try {
    meta = await pipeline.metadata();
  } catch {
    return null;
  }
  const fmt = meta.format;
  if (!fmt) return null;
  if (fmt === "svg") return null;
  // Animated GIF/WebP — sharp{animated:false} would drop frames; keep original.
  if ((fmt === "gif" || fmt === "webp") && (meta.pages ?? 1) > 1) {
    return null;
  }
  // Re-open the pipeline so `metadata()` doesn't consume it.
  pipeline = sharp(buf, { failOn: "none", animated: false }).rotate();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w > cfg.maxDimension || h > cfg.maxDimension) {
    pipeline = pipeline.resize({
      width: cfg.maxDimension,
      height: cfg.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const hasAlpha = meta.hasAlpha ?? false;
  let outFormat: "jpeg" | "webp" | "png";
  if (cfg.format === "jpeg") outFormat = "jpeg";
  else if (cfg.format === "webp") outFormat = "webp";
  else if (cfg.format === "original") {
    outFormat = fmt === "png" ? "png" : fmt === "webp" ? "webp" : "jpeg";
  } else {
    // auto
    outFormat = hasAlpha ? "png" : "jpeg";
  }

  if (outFormat === "jpeg") {
    // Flatten transparency over white so colours don't darken.
    if (hasAlpha) pipeline = pipeline.flatten({ background: "#ffffff" });
    pipeline = pipeline.jpeg({ quality: cfg.quality, mozjpeg: true });
  } else if (outFormat === "webp") {
    pipeline = pipeline.webp({ quality: cfg.quality });
  } else {
    pipeline = pipeline.png({ compressionLevel: 9 });
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buf: data,
    mime:
      outFormat === "jpeg"
        ? "image/jpeg"
        : outFormat === "webp"
          ? "image/webp"
          : "image/png",
    ext: outFormat === "jpeg" ? ".jpg" : `.${outFormat}`,
    width: info.width,
    height: info.height,
  };
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}
