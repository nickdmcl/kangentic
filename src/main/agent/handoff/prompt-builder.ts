import type { ContextPacket } from './context-packet';

/**
 * Build the prompt prefix that's prepended to the receiving agent's initial prompt.
 * Points the agent to the handoff-context.md file for full details.
 * Kept short to minimize token usage in the prompt - the file has the full context.
 */
export function buildHandoffPromptPrefix(packet: ContextPacket, contextFilePath: string): string {
  const sourceDisplayName = agentDisplayLabel(packet.source.agent);

  const lines: string[] = [];
  lines.push(`You are continuing work on this task that was previously handled by ${sourceDisplayName}.`);
  lines.push(`Full context of prior work (transcript, git changes, metrics) is at:`);
  lines.push(contextFilePath);
  lines.push('Read this file before continuing.');

  // Brief summary so the agent has immediate context without reading the file
  const fileCount = packet.gitSummary.filesChanged.length;
  const commitCount = packet.gitSummary.commitMessages.length;
  if (fileCount > 0 || commitCount > 0) {
    const parts: string[] = [];
    if (fileCount > 0) parts.push(`${fileCount} file${fileCount === 1 ? '' : 's'} changed`);
    if (commitCount > 0) parts.push(`${commitCount} commit${commitCount === 1 ? '' : 's'}`);
    lines.push('');
    lines.push(`Prior work: ${parts.join(', ')}.`);
  }

  return lines.join('\n');
}

function agentDisplayLabel(agent: string): string {
  switch (agent) {
    case 'claude': return 'Claude Code';
    case 'gemini': return 'Gemini CLI';
    case 'codex': return 'Codex CLI';
    case 'aider': return 'Aider';
    default: return agent;
  }
}
