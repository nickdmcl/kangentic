import { describe, it, expect } from 'vitest';
import {
  CONTEXT_PACKET_VERSION,
  type ContextPacket,
  type CodeReference,
  type ContinuationState,
} from '../../src/main/agent/handoff/context-packet';
import { renderHandoffMarkdown } from '../../src/main/agent/handoff/markdown-renderer';
import { buildHandoffPromptPrefix } from '../../src/main/agent/handoff/prompt-builder';

function createTestPacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    version: CONTEXT_PACKET_VERSION,
    id: 'test-packet-id',
    createdAt: '2026-04-04T15:30:00Z',
    source: {
      agent: 'claude',
      agentSessionId: 'session-123',
      modelId: 'claude-opus-4-6',
    },
    target: {
      agent: 'gemini',
    },
    task: {
      id: 'task-abc',
      displayId: 42,
      title: 'Implement user auth',
      description: 'Add bcrypt password hashing and JWT tokens',
      branchName: 'feature/user-auth',
      worktreePath: null,
      baseBranch: 'main',
      labels: ['auth', 'backend'],
    },
    gitSummary: {
      commitMessages: ['Add bcrypt hashing', 'Create JWT middleware'],
      filesChanged: [
        { relativePath: 'src/auth/service.ts', status: 'A', insertions: 85, deletions: 0 },
        { relativePath: 'src/auth/middleware.ts', status: 'M', insertions: 23, deletions: 8 },
      ],
      diffPatch: '--- a/src/auth/service.ts\n+++ b/src/auth/service.ts\n@@ -0,0 +1,85 @@\n+export class AuthService {}',
    },
    transcript: 'User: implement auth\nClaude: I will create the auth module...',
    events: [
      { ts: 1000, type: 'tool_start', tool: 'Edit', detail: 'src/auth/service.ts' },
      { ts: 2000, type: 'tool_end', tool: 'Edit' },
    ],
    metrics: {
      totalCostUsd: 0.45,
      totalInputTokens: 15000,
      totalOutputTokens: 3000,
      durationMs: 263000,
      toolCallCount: 28,
      linesAdded: 108,
      linesRemoved: 8,
      filesChanged: 2,
    },
    continuation: null,
    ...overrides,
  };
}

describe('ContextPacket', () => {
  it('serializes and deserializes cleanly', () => {
    const packet = createTestPacket();
    const json = JSON.stringify(packet);
    const parsed = JSON.parse(json) as ContextPacket;

    expect(parsed.version).toBe(CONTEXT_PACKET_VERSION);
    expect(parsed.source.agent).toBe('claude');
    expect(parsed.target.agent).toBe('gemini');
    expect(parsed.task.title).toBe('Implement user auth');
    expect(parsed.gitSummary.commitMessages).toHaveLength(2);
    expect(parsed.gitSummary.filesChanged).toHaveLength(2);
    expect(parsed.transcript).toContain('implement auth');
    expect(parsed.metrics?.totalCostUsd).toBe(0.45);
  });

  it('handles null optional fields', () => {
    const packet = createTestPacket({
      transcript: null,
      events: null,
      metrics: null,
      continuation: null,
    });
    const json = JSON.stringify(packet);
    const parsed = JSON.parse(json) as ContextPacket;

    expect(parsed.transcript).toBeNull();
    expect(parsed.events).toBeNull();
    expect(parsed.metrics).toBeNull();
    expect(parsed.continuation).toBeNull();
  });

  it('handles continuation state for future state machine', () => {
    const continuation: ContinuationState = {
      phase: 'review',
      completedSteps: ['implementation', 'tests'],
      pendingSteps: ['code-review', 'deploy'],
      metadata: { reviewerAgent: 'gemini', reviewType: 'security' },
    };
    const packet = createTestPacket({ continuation });
    const json = JSON.stringify(packet);
    const parsed = JSON.parse(json) as ContextPacket;

    expect(parsed.continuation?.phase).toBe('review');
    expect(parsed.continuation?.completedSteps).toEqual(['implementation', 'tests']);
    expect(parsed.continuation?.metadata.reviewerAgent).toBe('gemini');
  });

  it('handles empty git summary', () => {
    const packet = createTestPacket({
      gitSummary: { commitMessages: [], filesChanged: [], diffPatch: null },
    });
    const json = JSON.stringify(packet);
    const parsed = JSON.parse(json) as ContextPacket;

    expect(parsed.gitSummary.commitMessages).toEqual([]);
    expect(parsed.gitSummary.filesChanged).toEqual([]);
    expect(parsed.gitSummary.diffPatch).toBeNull();
  });
});

describe('renderHandoffMarkdown', () => {
  it('renders handoff root element with metadata attributes', () => {
    const packet = createTestPacket();
    const output = renderHandoffMarkdown(packet);

    expect(output).toContain('<handoff');
    expect(output).toContain('version="1"');
    expect(output).toContain('source="claude"');
    expect(output).toContain('target="gemini"');
    expect(output).toContain('branch="feature/user-auth"');
    expect(output).toContain('</handoff>');
  });

  it('renders task section with XML tags', () => {
    const packet = createTestPacket();
    const output = renderHandoffMarkdown(packet);

    expect(output).toContain('<task title="Implement user auth">');
    expect(output).toContain('Branch: feature/user-auth');
    expect(output).toContain('</task>');
  });

  it('renders metrics as self-closing XML element', () => {
    const packet = createTestPacket();
    const output = renderHandoffMarkdown(packet);

    expect(output).toContain('<metrics');
    expect(output).toContain('cost="$0.45"');
    expect(output).toContain('input_tokens="15k"');
    expect(output).toContain('tool_calls="28"');
    expect(output).toContain('/>');
  });

  it('renders git changes with XML tags and markdown table', () => {
    const packet = createTestPacket();
    const output = renderHandoffMarkdown(packet);

    expect(output).toContain('<git_changes');
    expect(output).toContain('<files_changed>');
    expect(output).toContain('src/auth/service.ts');
    expect(output).toContain('Added');
    expect(output).toContain('+85 -0');
    expect(output).toContain('</files_changed>');
    expect(output).toContain('</git_changes>');
  });

  it('renders commit messages inside commits tag', () => {
    const packet = createTestPacket();
    const output = renderHandoffMarkdown(packet);

    expect(output).toContain('<commits>');
    expect(output).toContain('Add bcrypt hashing');
    expect(output).toContain('Create JWT middleware');
    expect(output).toContain('</commits>');
  });

  it('renders transcript inside transcript tags', () => {
    const packet = createTestPacket();
    const output = renderHandoffMarkdown(packet);

    expect(output).toContain('<transcript>');
    expect(output).toContain('implement auth');
    expect(output).toContain('</transcript>');
  });

  it('omits empty sections gracefully', () => {
    const packet = createTestPacket({
      gitSummary: { commitMessages: [], filesChanged: [], diffPatch: null },
      transcript: null,
      metrics: null,
    });
    const output = renderHandoffMarkdown(packet);

    expect(output).not.toContain('<metrics');
    expect(output).not.toContain('<git_changes');
    expect(output).not.toContain('<transcript>');
    expect(output).toContain('<task title="Implement user auth">');
  });
});

describe('buildHandoffPromptPrefix', () => {
  it('includes source agent name', () => {
    const packet = createTestPacket();
    const prefix = buildHandoffPromptPrefix(packet, '.kangentic/sessions/xyz/handoff-context.md');

    expect(prefix).toContain('Claude Code');
  });

  it('includes context file path', () => {
    const packet = createTestPacket();
    const contextPath = '.kangentic/sessions/xyz/handoff-context.md';
    const prefix = buildHandoffPromptPrefix(packet, contextPath);

    expect(prefix).toContain(contextPath);
  });

  it('includes brief summary of changes', () => {
    const packet = createTestPacket();
    const prefix = buildHandoffPromptPrefix(packet, 'path/to/context.md');

    expect(prefix).toContain('2 files changed');
    expect(prefix).toContain('2 commits');
  });

  it('handles empty git summary', () => {
    const packet = createTestPacket({
      gitSummary: { commitMessages: [], filesChanged: [], diffPatch: null },
    });
    const prefix = buildHandoffPromptPrefix(packet, 'path/to/context.md');

    expect(prefix).toContain('Claude Code');
    expect(prefix).not.toContain('files changed');
  });
});
