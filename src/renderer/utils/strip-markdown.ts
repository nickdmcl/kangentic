import removeMarkdown from 'remove-markdown';

export function stripMarkdown(text: string): string {
  return removeMarkdown(text, { useImgAltText: false });
}
