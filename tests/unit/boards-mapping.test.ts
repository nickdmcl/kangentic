/**
 * Unit tests for src/main/boards/shared/mapping.ts
 *
 * Covers extractInlineImageUrls: markdown syntax, HTML syntax, deduplication,
 * non-http URL filtering, and empty-input handling.
 */
import { describe, it, expect } from 'vitest';
import { extractInlineImageUrls } from '../../src/main/boards/shared/mapping';

describe('extractInlineImageUrls', () => {
  it('extracts markdown image syntax', () => {
    const markdown = '![my screenshot](https://example.com/image.png)';
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://example.com/image.png');
    expect(results[0].altText).toBe('my screenshot');
  });

  it('extracts HTML img src attribute', () => {
    const markdown = '<img src="https://cdn.example.com/photo.jpg" alt="photo">';
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://cdn.example.com/photo.jpg');
  });

  it('extracts both markdown and HTML images from the same input', () => {
    const markdown = [
      '![logo](https://example.com/logo.png)',
      '<img src="https://example.com/banner.gif">',
    ].join('\n');
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(2);
    const urls = results.map((result) => result.url);
    expect(urls).toContain('https://example.com/logo.png');
    expect(urls).toContain('https://example.com/banner.gif');
  });

  it('deduplicates identical URLs across markdown and HTML syntax', () => {
    const sharedUrl = 'https://example.com/shared.png';
    const markdown = `![first](${sharedUrl})\n<img src="${sharedUrl}">`;
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe(sharedUrl);
  });

  it('deduplicates identical URLs appearing twice as markdown images', () => {
    const url = 'https://example.com/dup.png';
    const markdown = `![a](${url}) and again ![b](${url})`;
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(1);
  });

  it('skips data: URLs', () => {
    const markdown = '![inline](data:image/png;base64,abc123)';
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(0);
  });

  it('skips relative URLs', () => {
    const markdown = '![relative](/images/local.png)';
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(0);
  });

  it('skips file: URLs', () => {
    const markdown = '![file](file:///home/user/image.png)';
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(0);
  });

  it('accepts http:// URLs (not only https)', () => {
    const markdown = '![insecure](http://example.com/pic.jpg)';
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('http://example.com/pic.jpg');
  });

  it('returns empty array for empty string', () => {
    expect(extractInlineImageUrls('')).toHaveLength(0);
  });

  it('returns empty array for markdown with no images', () => {
    const markdown = '# Heading\n\nSome paragraph text with a [link](https://example.com).';
    expect(extractInlineImageUrls(markdown)).toHaveLength(0);
  });

  it('uses alt text to build filename when URL has no extension', () => {
    const markdown = '![my diagram](https://example.com/api/image/42)';
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(1);
    expect(results[0].filename).toMatch(/my_diagram\.png$/);
  });

  it('uses URL path segment as filename when it has a file extension', () => {
    const markdown = '![photo](https://example.com/uploads/photo.jpg)';
    const results = extractInlineImageUrls(markdown);
    expect(results).toHaveLength(1);
    expect(results[0].filename).toBe('photo.jpg');
  });
});
