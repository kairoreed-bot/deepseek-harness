/** Header parsers: the decoder-free path used where sharp's native library cannot be loaded. */

import { describe, expect, it } from 'vitest'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import { readImageHeader } from '../src/image-header.ts'
import { probeImage } from '../src/image.ts'
import { sharpUsable } from '../src/sharp.ts'

interface Fixture {
  name: string
  data: string
  expected: {
    mediaType: string
    width: number
    height: number
    animated: boolean
    depth: string
    space: string
    hasAlpha: boolean
    carriesMetadata: boolean
  }
}

/**
 * Real images produced by sharp, with the facts sharp reports for them, so the decoder-free path
 * is pinned to the same answers the native path gives.
 */
const FIXTURES: Fixture[] = [
  {
    name: 'png-rgba',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPgEpFrgGEGZA4ANR4EaVPyycAAAAAASUVORK5CYII=',
    expected: { mediaType: 'image/png', width: 3, height: 2, animated: false, depth: 'uchar', space: 'srgb', hasAlpha: true, carriesMetadata: false },
  },
  {
    name: 'png-rgb-exif',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAABP2lDQ1BpY2MAABiVfZC/SwJxGMY/11WWWA05NBQcJU0FUUtTgYZOEfgj1Kbz/FGgdt33QprLoaloiEZrCaLZxhz6A4KgIQqirdWghpKLrw5aUM/yfnh4Xt6XB5TnvFEQ3RoUirYVDvm1eCKpuV5Q8dLPIGO6IczlSDAKIPSSMGwrzw+936PIeTe9rhfTO6/Xq8kFpbo7UY4FP1Yu+F/udEYYwBfgM0zLBkUDxku2KXkJ8BrrehqUODBlxRNJUPakn2vxieRUiy8lW9FwAJQaoOU6ONXBhfy2vCslv/dkirEI0AeMIggTwv9HpreZCRBgBmRfv3sQ2bnZ1pZnEXqeHOdtElyH0DhynM9Tx2mcgfoIta32/mYF5uugHrS91DFc7cPIQ9vzVWCoDNUbU7f0pqUCXdkNqJ/DQAKGb8G99g3j4l+x2lMbhgAAAMBlWElmSUkqAAgAAAAHABIBAwABAAAAAQAAABoBBQABAAAAYgAAABsBBQABAAAAagAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAJiCAgACAAAAeAAAAGmHBAABAAAAcgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAAMAAAADoAQAAQAAAAIAAAAAAAAAnIgflwAAAAlwSFlzAAAD6AAAA+gBtXtSawAAABBJREFUCJljEDIJgyAGOAsAIwwDqUUMxGsAAAAASUVORK5CYII=',
    expected: { mediaType: 'image/png', width: 3, height: 2, animated: false, depth: 'uchar', space: 'srgb', hasAlpha: false, carriesMetadata: true },
  },
  {
    name: 'jpeg-plain',
    data: '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAUDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AK+AaEP/2Q==',
    expected: { mediaType: 'image/jpeg', width: 5, height: 3, animated: false, depth: 'uchar', space: 'srgb', hasAlpha: false, carriesMetadata: false },
  },
  {
    // EXIF orientation 6 rotates the stored 5x3 raster, so the perceived axes are 3x5
    name: 'jpeg-orient6',
    data: '/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAABgAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAAUAAAADoAQAAQAAAAMAAAAAAAAA/+IB8ElDQ19QUk9GSUxFAAEBAAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8AAEQgAAwAFAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAH/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCvgGhD/9k=',
    expected: { mediaType: 'image/jpeg', width: 3, height: 5, animated: false, depth: 'uchar', space: 'srgb', hasAlpha: false, carriesMetadata: true },
  },
  {
    name: 'webp-lossy',
    data: 'UklGRj4AAABXRUJQVlA4IDIAAADQAQCdASoHAAQAAUAmJaACdLoB+AADsAD+6SIf+8+fufP3Pn/Rn/+U/fI4/kcf/KBAAA==',
    expected: { mediaType: 'image/webp', width: 7, height: 4, animated: false, depth: 'uchar', space: 'srgb', hasAlpha: false, carriesMetadata: false },
  },
  {
    name: 'webp-lossless-alpha',
    data: 'UklGRh4AAABXRUJQVlA4TBEAAAAvAkAAEAdQiirUo4CBiOh/AAA=',
    expected: { mediaType: 'image/webp', width: 3, height: 2, animated: false, depth: 'uchar', space: 'srgb', hasAlpha: true, carriesMetadata: false },
  },
  {
    name: 'gif-single',
    data: 'R0lGODlhBAADAIAAAExpcf8AACH5BAUAAAAALAAAAAAEAAMAAAIDjI9WADs=',
    expected: { mediaType: 'image/gif', width: 4, height: 3, animated: false, depth: 'uchar', space: 'srgb', hasAlpha: true, carriesMetadata: false },
  },
]

const bytes = (fixture: Fixture): Uint8Array => new Uint8Array(Buffer.from(fixture.data, 'base64'))

describe('readImageHeader', () => {
  for (const fixture of FIXTURES) {
    it(`reads ${fixture.name} like the native decoder does`, () => {
      expect(readImageHeader(bytes(fixture))).toEqual(fixture.expected)
    })
  }

  it('matches the sharp probe exactly wherever sharp can load', async () => {
    if (!sharpUsable()) return
    for (const fixture of FIXTURES) {
      expect(readImageHeader(bytes(fixture))).toEqual(await probeImage(bytes(fixture)))
    }
  })

  it('needs only the header, so a truncated file still reports its dimensions', () => {
    const full = bytes(FIXTURES[0] as Fixture)
    expect(readImageHeader(full.subarray(0, 33))).toMatchObject({ mediaType: 'image/png', width: 3, height: 2 })
  })

  it('rejects bytes that are not a supported image', () => {
    for (const bad of [new Uint8Array(), new Uint8Array(16), new TextEncoder().encode('not an image at all')]) {
      expect(() => readImageHeader(bad)).toThrow(AttachmentError)
    }
  })

  it('rejects a PNG whose header cannot be read', () => {
    const png = bytes(FIXTURES[0] as Fixture)
    const corrupted = new Uint8Array(png)
    corrupted[12] = 0x20 // break the IHDR type
    expect(() => readImageHeader(corrupted)).toThrow(AttachmentError)
  })

  it('rejects a JPEG with no frame header', () => {
    // SOI followed by EOI: valid markers, no dimensions
    expect(() => readImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0])))
      .toThrow(AttachmentError)
  })

  it('reports animated when a GIF carries more than one frame descriptor', () => {
    // Structural fixture: a 1x1 GIF with two image descriptors and empty LZW payloads
    const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x00, 0x00, 0x00]
    const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00, 0x08, 0x00]
    const trailer = [0x3b]
    const single = new Uint8Array([...header, ...frame, ...trailer])
    const double = new Uint8Array([...header, ...frame, ...frame, ...trailer])
    expect(readImageHeader(single).animated).toBe(false)
    expect(readImageHeader(double).animated).toBe(true)
  })
})
