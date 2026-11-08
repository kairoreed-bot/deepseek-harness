/** The decoder-free path: what happens where sharp's native library cannot be loaded at all. */

import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ loads: 0 }))

vi.mock('../src/sharp.ts', () => ({
  // Loading sharp here is the bug this guards against: on Electron/Linux libvips aborts the process.
  requireSharp: () => {
    state.loads += 1
    throw new Error('sharp must not load in this process')
  },
  sharpUsable: () => false,
  warnDecoderUnavailable: () => {},
}))

import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import { readImageHeader } from '../src/image-header.ts'
import { detectImage, probeImage } from '../src/image.ts'
import { normalizeImage } from '../src/normalization.ts'

/** A 3x2 RGBA PNG, enough for every field the header path reports. */
const PNG = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPgEpFrgGEGZA4ANR4EaVPyycAAAAAASUVORK5CYII=',
  'base64',
))

const POLICY = { maxPixels: 10_000, maxDimension: 1_000, maxBytes: 64 * 1_024 }

describe('with the native decoder unavailable', () => {
  it('probes an image from its header without loading sharp', async () => {
    state.loads = 0
    await expect(probeImage(PNG)).resolves.toEqual(readImageHeader(PNG))
    expect(state.loads).toBe(0)
  })

  it('detects an image from its header and still enforces the admission limits', async () => {
    state.loads = 0
    await expect(detectImage(PNG, { maxPixels: 4, maxDimension: 100 }))
      .rejects.toMatchObject({ code: 'IMAGE_TOO_MANY_PIXELS' })
    await expect(detectImage(PNG, { maxDimension: 1 }))
      .rejects.toMatchObject({ code: 'IMAGE_DIMENSION_TOO_LARGE' })
    await expect(detectImage(PNG, POLICY)).resolves.toMatchObject({ width: 3, height: 2 })
    expect(state.loads).toBe(0)
  })

  it('keeps the admitted bytes instead of re-encoding', async () => {
    state.loads = 0
    const normalized = await normalizeImage(PNG, readImageHeader(PNG), POLICY)
    expect(normalized.data).toBe(PNG)
    expect(normalized).toMatchObject({ mediaType: 'image/png', width: 3, height: 2 })
    expect(state.loads).toBe(0)
  })

  it('still rejects data that is not a supported image', async () => {
    await expect(probeImage(Uint8Array.of(1, 2, 3))).rejects.toBeInstanceOf(AttachmentError)
  })
})
