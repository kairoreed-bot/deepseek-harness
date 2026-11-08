/**
 * Raster header inspection without a native decoder.
 *
 * Sharp cannot be used inside an Electron process on Linux: Electron's Linux binaries dynamically
 * link a global glib and leak its symbols into the process, so libvips trips
 * `GLib-GObject: g_object_ref: assertion 'G_IS_OBJECT (object)' failed` and the process aborts
 * (electron#46323, called out in sharp's own installation docs). That took out the whole desktop
 * Host whenever a model read an image.
 *
 * These parsers read the same fields sharp reports for the four formats this package accepts
 * (PNG, JPEG, WebP, GIF) straight from the header, so inspection cannot crash the process.
 */

import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { DetectedImage } from './image.ts'

const INVALID = 'Unsupported or malformed image data.'

/** A byte cursor over the encoded image, with explicit bounds failures. */
class Reader {
  readonly #data: Uint8Array
  #offset = 0

  constructor(data: Uint8Array) {
    this.#data = data
  }

  get offset(): number {
    return this.#offset
  }

  get remaining(): number {
    return this.#data.byteLength - this.#offset
  }

  /** Total byte length of the encoded image. */
  get byteLength(): number {
    return this.#data.byteLength
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.#data.byteLength) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
    this.#offset = offset
  }

  skip(count: number): void {
    this.seek(this.#offset + count)
  }

  private take(count: number): Uint8Array {
    if (count < 0 || this.#offset + count > this.#data.byteLength) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
    const slice = this.#data.subarray(this.#offset, this.#offset + count)
    this.#offset += count
    return slice
  }

  uint8(): number {
    return this.take(1)[0] as number
  }

  uint16be(): number {
    const bytes = this.take(2)
    return ((bytes[0] as number) << 8) | (bytes[1] as number)
  }

  uint16le(): number {
    const bytes = this.take(2)
    return (bytes[0] as number) | ((bytes[1] as number) << 8)
  }

  uint24le(): number {
    const bytes = this.take(3)
    return (bytes[0] as number) | ((bytes[1] as number) << 8) | ((bytes[2] as number) << 16)
  }

  uint32be(): number {
    const bytes = this.take(4)
    return (((bytes[0] as number) << 24) | ((bytes[1] as number) << 16) | ((bytes[2] as number) << 8) | (bytes[3] as number)) >>> 0
  }

  uint32le(): number {
    const bytes = this.take(4)
    return (((bytes[3] as number) << 24) | ((bytes[2] as number) << 16) | ((bytes[1] as number) << 8) | (bytes[0] as number)) >>> 0
  }

  ascii(count: number): string {
    return String.fromCharCode(...this.take(count))
  }

  /** Peek a chunk type without consuming it. */
  peekAscii(count: number, offset = this.#offset): string {
    if (offset + count > this.#data.byteLength) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
    return String.fromCharCode(...this.#data.subarray(offset, offset + count))
  }

  /** Bytes from an absolute offset, capped at the end of the buffer. */
  slice(offset: number, count: number): Uint8Array {
    if (offset < 0 || offset > this.#data.byteLength) return new Uint8Array()
    return this.#data.subarray(offset, Math.min(offset + count, this.#data.byteLength))
  }

  /** Whether `text` occurs anywhere in the remaining bytes. */
  includes(text: string): boolean {
    return Buffer.from(this.#data.subarray(this.#offset)).includes(text)
  }
}

/** Orientations 5-8 transpose the stored raster, so the perceived axes are swapped. */
function perceived(width: number, height: number, orientation: number | undefined): { width: number; height: number } {
  return orientation !== undefined && orientation >= 5 ? { width: height, height: width } : { width, height }
}

function parsePng(reader: Reader): DetectedImage {
  reader.skip(8) // signature, already matched
  const chunkLength = reader.uint32be()
  if (reader.ascii(4) !== 'IHDR' || chunkLength < 13) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
  const width = reader.uint32be()
  const height = reader.uint32be()
  const bitDepth = reader.uint8()
  const colorType = reader.uint8()

  let animated = false
  let carriesMetadata = false
  let hasAlpha = colorType === 4 || colorType === 6

  // Walk the chunk table from the start of IHDR's payload, looking for the facts sharp reports.
  let offset = 8 + 8 + 13 + 4 // signature + (length + type) + IHDR payload + IHDR CRC
  while (offset + 8 <= reader.byteLength) {
    const header = reader.slice(offset, 8)
    if (header.byteLength < 8) break
    const length = (((header[0] as number) << 24) | ((header[1] as number) << 16)
      | ((header[2] as number) << 8) | (header[3] as number)) >>> 0
    const type = String.fromCharCode(...header.subarray(4, 8))
    if (type === 'acTL') animated = true
    else if (type === 'tRNS') hasAlpha = true
    else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt' || type === 'eXIf' || type === 'iCCP') carriesMetadata = true
    else if (type === 'IEND') break
    offset += 12 + length
  }

  const depth = bitDepth === 16 ? 'ushort' : bitDepth === 8 ? 'uchar' : `${bitDepth}-bit`
  return { mediaType: 'image/png', width, height, animated, carriesMetadata, depth, space: 'srgb', hasAlpha }
}

/** Read the EXIF orientation tag from an APP1 payload, when present. */
function exifOrientation(reader: Reader, offset: number, length: number): number | undefined {
  const payload = reader.slice(offset, length)
  // "Exif\0\0" then a TIFF header: byte order, 42, offset of IFD0
  if (payload.byteLength < 14) return undefined
  const little = payload[6] === 0x49 && payload[7] === 0x49
  const read16 = (at: number): number => {
    const a = payload[at] as number
    const b = payload[at + 1] as number
    return little ? a | (b << 8) : (a << 8) | b
  }
  const read32 = (at: number): number => {
    const a = payload[at] as number
    const b = payload[at + 1] as number
    const c = payload[at + 2] as number
    const d = payload[at + 3] as number
    return little
      ? ((d << 24) | (c << 16) | (b << 8) | a) >>> 0
      : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
  }
  if (read16(8) !== 0x002a) return undefined
  const ifd = 6 + read32(10)
  if (ifd + 2 > payload.byteLength) return undefined
  const entries = read16(ifd)
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > payload.byteLength) return undefined
    if (read16(entry) === 0x0112) {
      const value = read16(entry + 8)
      return value >= 1 && value <= 8 ? value : undefined
    }
  }
  return undefined
}

function parseJpeg(reader: Reader): DetectedImage {
  reader.skip(2) // SOI
  let width = 0
  let height = 0
  let depth = 'uchar'
  let orientation: number | undefined
  let carriesMetadata = false

  while (reader.remaining >= 4) {
    // Every header segment starts with 0xFF; anything else means we reached the entropy-coded
    // scan data, where the facts we need have already been read.
    if (reader.uint8() !== 0xff) break
    let marker = reader.uint8()
    // Fill bytes: any number of 0xFF may precede a marker
    while (marker === 0xff && reader.remaining > 0) marker = reader.uint8()
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    // EOI, or the start of the scan: header parsing ends here
    if (marker === 0xd9 || marker === 0xda) break
    const length = reader.uint16be()
    if (length < 2) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
    const payloadOffset = reader.offset

    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      const precision = reader.uint8()
      height = reader.uint16be()
      width = reader.uint16be()
      depth = precision === 8 ? 'uchar' : precision === 16 ? 'ushort' : `${precision}-bit`
      if (width === 0 || height === 0) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
    } else if (marker === 0xe1) {
      const signature = reader.slice(payloadOffset, 6)
      if (signature[0] === 0x45 && signature[1] === 0x78 && signature[2] === 0x69 && signature[3] === 0x66) {
        carriesMetadata = true
        orientation = exifOrientation(reader, payloadOffset, length - 2)
      } else {
        carriesMetadata = true // XMP or another APP1 payload
      }
    } else if (marker === 0xe2 || marker === 0xed || marker === 0xfe) {
      // ICC profile, IPTC/Photoshop, or a comment
      carriesMetadata = true
    }

    reader.seek(payloadOffset + length - 2)
  }

  if (width === 0 || height === 0) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
  const size = perceived(width, height, orientation)
  return {
    mediaType: 'image/jpeg',
    width: size.width,
    height: size.height,
    animated: false,
    carriesMetadata,
    depth,
    space: 'srgb',
    hasAlpha: false,
  }
}

function parseGif(reader: Reader): DetectedImage {
  reader.skip(6) // GIF87a / GIF89a
  const width = reader.uint16le()
  const height = reader.uint16le()
  if (width === 0 || height === 0) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
  const packed = reader.uint8()
  reader.skip(2) // background colour index, pixel aspect ratio
  if ((packed & 0x80) !== 0) reader.skip(3 * 2 ** ((packed & 0x07) + 1)) // global colour table

  let frames = 0
  let hasAlpha = false
  let carriesMetadata = false
  let animatedFlag = false

  while (reader.remaining > 0) {
    const block = reader.uint8()
    if (block === 0x3b) break // trailer
    if (block === 0x2c) {
      frames += 1
      const descriptor = reader.slice(reader.offset, 9)
      if (descriptor.byteLength < 9) break
      const localPacked = descriptor[8] as number
      reader.skip(9)
      if ((localPacked & 0x80) !== 0) reader.skip(3 * 2 ** ((localPacked & 0x07) + 1))
      reader.skip(1) // LZW minimum code size
      skipSubBlocks(reader)
      continue
    }
    if (block === 0x21) {
      const label = reader.uint8()
      if (label === 0xf9) {
        // Graphic control extension: transparency flag lives in the packed field
        const size = reader.uint8()
        const control = reader.slice(reader.offset, 1)
        if (((control[0] as number) & 0x01) !== 0) hasAlpha = true
        reader.skip(size)
        reader.skip(1) // block terminator
        continue
      }
      if (label === 0xff) {
        const size = reader.uint8()
        const identifier = reader.slice(reader.offset, size)
        reader.skip(size)
        if (String.fromCharCode(...identifier.subarray(0, 11)) === 'NETSCAPE2.0') animatedFlag = true
        skipSubBlocks(reader)
        continue
      }
      if (label === 0xfe) carriesMetadata = true // comment extension
      const size = reader.uint8()
      reader.skip(size)
      skipSubBlocks(reader)
      continue
    }
    // Unknown block: stop rather than guess at the remaining structure
    break
  }

  return {
    mediaType: 'image/gif',
    width,
    height,
    animated: animatedFlag || frames > 1,
    carriesMetadata,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha,
  }
}

function skipSubBlocks(reader: Reader): void {
  while (reader.remaining > 0) {
    const size = reader.uint8()
    if (size === 0) return
    reader.skip(size)
  }
}

function parseWebp(reader: Reader): DetectedImage {
  reader.skip(12) // RIFF, size, WEBP
  let width = 0
  let height = 0
  let animated = false
  let hasAlpha = false
  let carriesMetadata = false

  while (reader.remaining >= 8) {
    const type = reader.ascii(4)
    const size = reader.uint32le()
    const payload = reader.offset
    if (type === 'VP8 ') {
      // Lossy: 3-byte frame tag, then the start code, then 14-bit dimensions
      const frame = reader.slice(payload, 10)
      if (frame.byteLength < 10) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
      if (frame[3] === 0x9d && frame[4] === 0x01 && frame[5] === 0x2a) {
        width = ((frame[6] as number) | ((frame[7] as number) << 8)) & 0x3fff
        height = ((frame[8] as number) | ((frame[9] as number) << 8)) & 0x3fff
      }
    } else if (type === 'VP8L') {
      // Lossless: 0x2F signature, then two 14-bit sizes and a 1-bit alpha flag
      const lossless = reader.slice(payload, 5)
      if (lossless.byteLength < 5 || lossless[0] !== 0x2f) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
      const low = (lossless[1] as number) | ((lossless[2] as number) << 8)
      const bits = (low | ((lossless[3] as number) << 16) | ((lossless[4] as number) << 24)) >>> 0
      width = (bits & 0x3fff) + 1
      height = ((bits >>> 14) & 0x3fff) + 1
      hasAlpha = ((bits >>> 28) & 0x01) === 1
    } else if (type === 'VP8X') {
      const flags = reader.slice(payload, 10)
      if (flags.byteLength < 10) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
      const features = flags[0] as number
      hasAlpha = (features & 0x10) !== 0
      animated = (features & 0x02) !== 0
      width = 1 + ((flags[4] as number) | ((flags[5] as number) << 8) | ((flags[6] as number) << 16))
      height = 1 + ((flags[7] as number) | ((flags[8] as number) << 8) | ((flags[9] as number) << 16))
    } else if (type === 'ANIM' || type === 'ANMF') {
      animated = true
    } else if (type === 'ICCP' || type === 'EXIF' || type === 'XMP ') {
      carriesMetadata = true
    }
    reader.seek(payload + size + (size % 2)) // chunks are padded to an even length
    if (width !== 0 && height !== 0 && type === 'VP8X') break
  }

  if (width === 0 || height === 0) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
  return { mediaType: 'image/webp', width, height, animated, carriesMetadata, depth: 'uchar', space: 'srgb', hasAlpha }
}

/**
 * Read intrinsic image facts from the encoded header.
 * @param data - complete encoded image bytes.
 * @returns the facts sharp's `metadata()` would report for the supported formats.
 */
export function readImageHeader(data: Uint8Array): DetectedImage {
  if (data.byteLength < 12) throw new AttachmentError(INVALID, 'INVALID_IMAGE')
  const reader = new Reader(data)
  const signature = reader.peekAscii(4)
  if (signature === '\x89PNG') return parsePng(reader)
  if (data[0] === 0xff && data[1] === 0xd8) return parseJpeg(reader)
  if (signature === 'GIF8') return parseGif(reader)
  if (signature === 'RIFF' && reader.peekAscii(4, 8) === 'WEBP') return parseWebp(reader)
  throw new AttachmentError(INVALID, 'INVALID_IMAGE')
}

/** Media types this parser understands, for error messages and guards. */
export const HEADER_MEDIA_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
