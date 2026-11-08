/** Process-realm lazy access to Sharp's CommonJS-compatible entry. */

import type sharp from 'sharp'
import { createLazyRequire } from '@deepseek-ai/dsh-lazy-require'

/** Load Sharp on the first raster operation and retain its callable export. */
export const requireSharp = createLazyRequire<typeof sharp>('sharp', import.meta.url)

/** Versions map entry Electron sets; absent under a plain Node runtime. */
const electronVersion = (process.versions as Record<string, string | undefined>).electron

/**
 * Whether Sharp's native decoder can be used in this process.
 *
 * Electron on Linux dynamically links a globally-installed glib and leaks its symbols into the
 * process space, so libvips aborts with
 * `GLib-GObject: g_object_ref: assertion 'G_IS_OBJECT (object)' failed`
 * (electron#46323, listed under "Known conflicts" in sharp's installation docs). That killed the
 * whole desktop Host the moment a model read an image, so on that combination callers use the
 * header parsers instead and never load the native library.
 * @returns whether the native decoder is safe to load here.
 */
export function sharpUsable(): boolean {
  return !(process.platform === 'linux' && electronVersion !== undefined)
}

let warned = false

/**
 * Report once that raster work runs without the native decoder, so the quality difference is
 * visible in the log instead of being silent.
 * @param area - the caller that degraded, for the message.
 */
export function warnDecoderUnavailable(area: string): void {
  if (warned) return
  warned = true
  console.warn(
    'dsh attachment: sharp is disabled in this process (Electron on Linux, electron#46323); '
    + `${area} runs without the native decoder.`,
  )
}
