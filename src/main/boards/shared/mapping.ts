import { URL } from 'node:url';

/** Extract image URLs from markdown text. Source-agnostic helper used by all adapters. */
export function extractInlineImageUrls(
  markdown: string,
): Array<{ url: string; altText: string; filename: string }> {
  const results: Array<{ url: string; altText: string; filename: string }> = [];
  const seen = new Set<string>();

  const markdownImagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = markdownImagePattern.exec(markdown)) !== null) {
    const altText = match[1];
    const url = match[2];
    if (url && !seen.has(url) && isHttpUrl(url)) {
      seen.add(url);
      results.push({ url, altText, filename: filenameFromUrl(url, altText) });
    }
  }

  const htmlImagePattern = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((match = htmlImagePattern.exec(markdown)) !== null) {
    const url = match[1];
    if (url && !seen.has(url) && isHttpUrl(url)) {
      seen.add(url);
      results.push({ url, altText: '', filename: filenameFromUrl(url, '') });
    }
  }

  return results;
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function filenameFromUrl(url: string, altText: string): string {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1];
    if (lastSegment && /\.\w{2,5}$/.test(lastSegment)) {
      return decodeURIComponent(lastSegment);
    }
  } catch {
    /* fallback below */
  }

  if (altText && altText.length > 0 && altText.length < 80) {
    const sanitized = altText.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${sanitized}.png`;
  }

  return `image_${Date.now()}.png`;
}
