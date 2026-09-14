import { createHash } from 'node:crypto';
import type { SourceFrameFormat } from './models.js';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_PIXELS = 64_000_000;

export class FrameImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameImageError';
  }
}

export interface FrameImageInfo {
  bytes: Buffer;
  format: SourceFrameFormat;
  mimeType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
  width: number;
  height: number;
  sha256: string;
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Buffer): Omit<FrameImageInfo, 'bytes' | 'sha256'> | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  let offset = 8;
  let hasData = false;
  let hasEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > MAX_BYTES || offset + length + 12 > bytes.length) return null;
    const expectedCrc = bytes.readUInt32BE(offset + length + 8);
    if (crc32(bytes.subarray(offset + 4, offset + length + 8)) !== expectedCrc) return null;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') hasData = true;
    if (type === 'IEND') { hasEnd = length === 0 && offset + 12 === bytes.length; break; }
    offset += length + 12;
  }
  if (!hasData || !hasEnd) return null;
  return {
    format: 'png', mimeType: 'image/png', extension: 'png',
    width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
  };
}

function inspectJpeg(bytes: Buffer): Omit<FrameImageInfo, 'bytes' | 'sha256'> | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let dimensions: { width: number; height: number } | null = null;
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (sof.has(marker)) {
      if (length < 7) return null;
      dimensions = { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    if (marker === 0xda) {
      if (!dimensions || offset + length >= bytes.length - 2) return null;
      return { format: 'jpeg', mimeType: 'image/jpeg', extension: 'jpg', ...dimensions };
    }
    offset += length;
  }
  return null;
}

export function inspectFrameImage(input: Uint8Array, expectedFormat?: SourceFrameFormat): FrameImageInfo {
  const bytes = Buffer.from(input);
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new FrameImageError('Frame image is empty or too large');
  const image = inspectPng(bytes) ?? inspectJpeg(bytes);
  if (!image || image.width < 1 || image.height < 1 || image.width > 16_384 || image.height > 16_384
    || image.width * image.height > MAX_PIXELS) throw new FrameImageError('Frame output is not a valid PNG or JPEG');
  if (expectedFormat && image.format !== expectedFormat) throw new FrameImageError('Frame output format does not match the request');
  return { bytes, ...image, sha256: createHash('sha256').update(bytes).digest('hex') };
}

