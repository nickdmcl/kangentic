import type { TranscriptEntry } from './types';

/**
 * Format a parsed transcript as a markdown document suitable for pasting
 * into issues, PRs, chat, or for handing off as cross-agent context. Tool
 * results are inlined under their owning tool_use block by id.
 *
 * Lives in `shared/` because both the renderer (Transcript tab copy button)
 * and the main process (MCP `get_transcript` structured format) call it.
 */
export function transcriptToMarkdown(entries: TranscriptEntry[]): string {
  const resultsByUseId = new Map<string, { content: string; isError: boolean }>();
  for (const entry of entries) {
    if (entry.kind === 'tool_result' && entry.toolUseId) {
      resultsByUseId.set(entry.toolUseId, { content: entry.content, isError: !!entry.isError });
    }
  }

  const sections: string[] = [];
  for (const entry of entries) {
    if (entry.kind === 'tool_result') continue;
    if (entry.kind === 'user') {
      sections.push(`## User\n\n${entry.text.trim()}`);
      continue;
    }
    // assistant
    const parts: string[] = [];
    parts.push(entry.model ? `## Assistant (${entry.model})` : '## Assistant');
    parts.push('');
    for (const block of entry.blocks) {
      if (block.type === 'text') {
        parts.push(block.text.trim());
        parts.push('');
      } else if (block.type === 'thinking') {
        parts.push('> _thinking_');
        parts.push('');
        parts.push(`> ${block.text.trim().split('\n').join('\n> ')}`);
        parts.push('');
      } else if (block.type === 'tool_use') {
        parts.push(`**Tool:** \`${block.name}\``);
        parts.push('');
        parts.push('```json');
        parts.push(safeJson(block.input));
        parts.push('```');
        const result = resultsByUseId.get(block.id);
        if (result) {
          parts.push('');
          parts.push(result.isError ? '**Error:**' : '**Result:**');
          parts.push('');
          parts.push('```');
          parts.push(result.content);
          parts.push('```');
        }
        parts.push('');
      }
    }
    sections.push(parts.join('\n').trimEnd());
  }
  return sections.join('\n\n').trim() + '\n';
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
