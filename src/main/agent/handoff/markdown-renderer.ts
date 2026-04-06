import type { ContextPacket, CodeReference } from './context-packet';
import { cleanTranscriptForHandoff } from './transcript-cleanup';

/**
 * Render a ContextPacket into an XML-structured document for LLM consumption.
 *
 * Uses XML tags to clearly delineate sections (task, metrics, git changes,
 * transcript) so the receiving agent can unambiguously parse each part.
 * This follows prompt engineering best practices from Anthropic, OpenAI,
 * and Google - all three recommend XML tags for structuring context documents.
 *
 * Written to .kangentic/sessions/<targetSessionId>/handoff-context.md
 */
export function renderHandoffMarkdown(packet: ContextPacket): string {
  const lines: string[] = [];

  // Root element with handoff metadata as attributes
  const branchAttr = packet.task.branchName ? ` branch="${packet.task.branchName}"` : '';
  const filesAttr = packet.gitSummary.filesChanged.length > 0
    ? ` files_changed="${packet.gitSummary.filesChanged.length}"`
    : '';
  lines.push(`<handoff version="${packet.version}" source="${packet.source.agent}" target="${packet.target.agent}" task_id="${packet.task.id}" task_display_id="${packet.task.displayId}" created_at="${packet.createdAt}"${branchAttr}${filesAttr}>`);
  lines.push('');

  // Task section
  lines.push(`<task title="${escapeXmlAttr(packet.task.title)}">`);
  if (packet.task.description) {
    lines.push(packet.task.description);
  }
  if (packet.task.branchName) {
    lines.push(`Branch: ${packet.task.branchName}`);
  }
  lines.push('</task>');
  lines.push('');

  // Metrics section
  if (packet.metrics) {
    const metricAttrs: string[] = [];
    if (packet.source.agent) {
      metricAttrs.push(`agent="${packet.source.agent}"`);
    }
    if (packet.source.modelId) {
      metricAttrs.push(`model="${packet.source.modelId}"`);
    }
    if (packet.metrics.durationMs > 0) {
      metricAttrs.push(`duration="${formatDuration(packet.metrics.durationMs)}"`);
    }
    if (packet.metrics.totalCostUsd > 0) {
      metricAttrs.push(`cost="$${packet.metrics.totalCostUsd.toFixed(2)}"`);
      metricAttrs.push(`input_tokens="${formatTokens(packet.metrics.totalInputTokens)}"`);
      metricAttrs.push(`output_tokens="${formatTokens(packet.metrics.totalOutputTokens)}"`);
    }
    if (packet.metrics.toolCallCount > 0) {
      metricAttrs.push(`tool_calls="${packet.metrics.toolCallCount}"`);
    }
    lines.push(`<metrics ${metricAttrs.join(' ')} />`);
    lines.push('');
  }

  // Git changes section
  if (packet.gitSummary.commitMessages.length > 0 || packet.gitSummary.filesChanged.length > 0) {
    const commitCount = packet.gitSummary.commitMessages.length;
    lines.push(`<git_changes${commitCount > 0 ? ` commits="${commitCount}"` : ''}>`);

    // Commit messages
    if (packet.gitSummary.commitMessages.length > 0) {
      lines.push('<commits>');
      for (const message of packet.gitSummary.commitMessages) {
        lines.push(`- ${message}`);
      }
      lines.push('</commits>');
    }

    // Files changed table
    if (packet.gitSummary.filesChanged.length > 0) {
      lines.push('<files_changed>');
      lines.push('| File | Status | +/- |');
      lines.push('|------|--------|-----|');
      for (const file of packet.gitSummary.filesChanged) {
        lines.push(`| ${file.relativePath} | ${formatStatus(file.status)} | +${file.insertions} -${file.deletions} |`);
      }
      lines.push('</files_changed>');
    }

    lines.push('</git_changes>');
    lines.push('');
  }

  // Session transcript (cleaned of TUI rendering noise)
  if (packet.transcript) {
    const cleaned = cleanTranscriptForHandoff(packet.transcript, packet.source.agent);
    if (cleaned) {
      lines.push('<transcript>');
      lines.push(cleaned);
      lines.push('</transcript>');
      lines.push('');
    }
  }

  lines.push('</handoff>');

  return lines.join('\n');
}

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}k`;
  return String(count);
}

function formatStatus(status: CodeReference['status']): string {
  switch (status) {
    case 'A': return 'Added';
    case 'M': return 'Modified';
    case 'D': return 'Deleted';
    case 'R': return 'Renamed';
    default: return status;
  }
}
