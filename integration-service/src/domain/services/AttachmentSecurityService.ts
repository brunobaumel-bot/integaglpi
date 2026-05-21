import { createHash } from 'node:crypto';

export type AttachmentStatus = 'received' | 'validated' | 'blocked' | 'synced' | 'failed' | 'deleted';

export interface AttachmentValidationInput {
  buffer: Buffer;
  filename: string | null | undefined;
  declaredMime: string | null | undefined;
  messageType: string;
  maxBytes?: number;
}

export interface AttachmentValidationResult {
  ok: boolean;
  status: AttachmentStatus;
  reason: string | null;
  sha256: string;
  mimeDetected: string;
  extension: string;
  filenameSanitized: string;
  sizeBytes: number;
}

const DEFAULT_MAX_BYTES = 15_728_640;
const MAX_FILENAME_LENGTH = 180;

const DANGEROUS_EXTENSIONS = new Set([
  'exe',
  'bat',
  'cmd',
  'sh',
  'vbs',
  'js',
  'jar',
  'msi',
  'php',
  'phtml',
  'ps1',
  'com',
  'scr',
  'dll',
  'reg',
]);

const EXTENSION_MIME_ALLOWLIST: Record<string, readonly string[]> = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  txt: ['text/plain'],
  csv: ['text/csv', 'text/plain'],
  ogg: ['audio/ogg'],
  opus: ['audio/ogg'],
  mp3: ['audio/mpeg'],
  m4a: ['audio/mp4', 'video/mp4'],
  aac: ['audio/aac'],
  webm: ['audio/webm', 'video/webm'],
  mp4: ['video/mp4', 'audio/mp4'],
  '3gp': ['video/3gpp'],
};

const TYPE_LIMITS_BYTES: Record<string, number> = {
  image: 15_728_640,
  document: 15_728_640,
  audio: 16 * 1024 * 1024,
  video: 64 * 1024 * 1024,
};

function normalizeMime(value: string | null | undefined): string {
  return (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function stripAccents(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function redactFilenamePii(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]');
}

export function sanitizeAttachmentFilename(rawFilename: string | null | undefined, fallbackExtension = ''): string {
  const base = (rawFilename ?? '').split(/[\\/]+/).pop() ?? '';
  const originalExtension = extensionOf(base);
  const extensionSuffix = originalExtension !== ''
    ? `.${originalExtension}`
    : fallbackExtension !== ''
      ? `.${fallbackExtension.replace(/^\./, '')}`
      : '';
  const normalized = stripAccents(redactFilenamePii(base))
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();

  if (normalized !== '' && normalized !== '_' && normalized !== '.') {
    return extensionOf(normalized) === '' && extensionSuffix !== ''
      ? `${normalized}${extensionSuffix}`
      : normalized;
  }

  return `attachment${fallbackExtension ? `.${fallbackExtension}` : ''}`;
}

function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : '';
}

function hasPathTraversal(rawFilename: string | null | undefined): boolean {
  const value = (rawFilename ?? '').trim();
  if (value === '') {
    return false;
  }

  return value.includes('/')
    || value.includes('\\')
    || /(^|[\\/])\.\.([\\/]|$)/.test(value)
    || /^[A-Za-z]:/.test(value);
}

function detectZipOffice(buffer: Buffer, extension: string): string {
  if (extension === 'docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (extension === 'xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  return 'application/zip';
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.byteLength, 4096));
  if (sample.byteLength === 0) {
    return false;
  }

  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
      return false;
    }
  }

  return true;
}

function detectMimeByMagicBytes(buffer: Buffer, extension: string): string {
  if (buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.byteLength >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.byteLength >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.byteLength >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  if (buffer.byteLength >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'audio/ogg';
  }
  if (buffer.byteLength >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') {
    return 'audio/mpeg';
  }
  if (buffer.byteLength >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return extension === 'aac' ? 'audio/aac' : 'audio/mpeg';
  }
  if (buffer.byteLength >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 16).toString('ascii').toLowerCase();
    if (brand.includes('3gp')) {
      return 'video/3gpp';
    }
    return extension === 'm4a' ? 'audio/mp4' : 'video/mp4';
  }
  if (buffer.byteLength >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return extension === 'webm' ? 'audio/webm' : 'application/octet-stream';
  }
  if (buffer.byteLength >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return extension === 'xls' ? 'application/vnd.ms-excel' : 'application/msword';
  }
  if (buffer.byteLength >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)) {
    return detectZipOffice(buffer, extension);
  }
  if ((extension === 'txt' || extension === 'csv') && looksLikeText(buffer)) {
    return extension === 'csv' ? 'text/csv' : 'text/plain';
  }

  return 'application/octet-stream';
}

function isAllowedExtensionMime(extension: string, mime: string): boolean {
  const allowed = EXTENSION_MIME_ALLOWLIST[extension];
  return Array.isArray(allowed) && allowed.includes(mime);
}

function fallbackExtensionForMime(mime: string): string {
  for (const [extension, mimes] of Object.entries(EXTENSION_MIME_ALLOWLIST)) {
    if (mimes.includes(mime)) {
      return extension;
    }
  }
  return '';
}

export class AttachmentSecurityService {
  public validate(input: AttachmentValidationInput): AttachmentValidationResult {
    const declaredMime = normalizeMime(input.declaredMime);
    const fallbackExtension = fallbackExtensionForMime(declaredMime);
    const filenameSanitized = sanitizeAttachmentFilename(input.filename, fallbackExtension);
    const extension = extensionOf(filenameSanitized);
    const sizeBytes = input.buffer.byteLength;
    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    const maxBytes = input.maxBytes ?? TYPE_LIMITS_BYTES[input.messageType] ?? DEFAULT_MAX_BYTES;

    const blocked = (reason: string, mimeDetected = 'application/octet-stream'): AttachmentValidationResult => ({
      ok: false,
      status: 'blocked',
      reason,
      sha256,
      mimeDetected,
      extension,
      filenameSanitized,
      sizeBytes,
    });

    if (sizeBytes <= 0) {
      return blocked('empty_file');
    }
    if (sizeBytes > maxBytes) {
      return blocked('file_too_large');
    }
    if (hasPathTraversal(input.filename)) {
      return blocked('path_traversal_attempt');
    }
    if (DANGEROUS_EXTENSIONS.has(extension)) {
      return blocked('dangerous_extension');
    }
    if (extension === '' || !Object.prototype.hasOwnProperty.call(EXTENSION_MIME_ALLOWLIST, extension)) {
      return blocked('extension_not_allowed');
    }
    if (/[\\/]/.test(filenameSanitized) || filenameSanitized.includes('..')) {
      return blocked('path_traversal_attempt');
    }

    const mimeDetected = detectMimeByMagicBytes(input.buffer, extension);
    if (!isAllowedExtensionMime(extension, mimeDetected)) {
      return blocked('mime_extension_mismatch', mimeDetected);
    }
    if (declaredMime !== '' && declaredMime !== 'application/octet-stream' && !isAllowedExtensionMime(extension, declaredMime)) {
      return blocked('declared_mime_extension_mismatch', mimeDetected);
    }

    return {
      ok: true,
      status: 'validated',
      reason: null,
      sha256,
      mimeDetected,
      extension,
      filenameSanitized,
      sizeBytes,
    };
  }
}
