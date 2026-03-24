import fs from 'node:fs';
import path from 'node:path';

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.log': 'text/plain',
};

export interface ReadFileResult {
  filename: string;
  base64Data: string;
  mediaType: string;
  sizeBytes: number;
}

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Read a file from disk and return it as base64 with metadata.
 * Used by MCP command handlers to attach files from absolute paths.
 */
export function readFileAsAttachment(filePath: string, overrideFilename?: string): ReadFileResult {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File too large (${Math.round(stat.size / 1024 / 1024)}MB). Maximum attachment size is ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB.`);
  }

  const buffer = fs.readFileSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mediaType = EXTENSION_MEDIA_TYPES[extension] ?? 'application/octet-stream';
  const filename = overrideFilename ?? path.basename(filePath);

  return {
    filename,
    base64Data: buffer.toString('base64'),
    mediaType,
    sizeBytes: buffer.length,
  };
}
