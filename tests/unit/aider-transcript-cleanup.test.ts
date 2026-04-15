/**
 * Unit tests for Aider transcript cleanup.
 *
 * Verifies that Aider-specific TUI noise is stripped and that the last
 * prompt+response turn is extracted for handoff context.
 */
import { describe, it, expect } from 'vitest';
import { cleanAiderTranscript } from '../../src/main/agent/adapters/aider/transcript-cleanup';
import { cleanTranscriptForHandoff } from '../../src/main/agent/handoff/transcript-cleanup';

describe('cleanAiderTranscript', () => {
  it('strips token usage lines', () => {
    const raw = [
      'aider> Fix the bug',
      'Tokens: 1,234 sent, 567 received',
      'I found the issue in main.ts and fixed it.',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).not.toContain('Tokens:');
    expect(result).toContain('Fix the bug');
    expect(result).toContain('I found the issue');
  });

  it('strips repo map indicators', () => {
    const raw = [
      'aider> Update the API',
      'Repo-map: using 1024 tokens',
      'Added src/api.ts to the chat',
      'Dropped src/old.ts from the chat',
      'I updated the API endpoints.',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).not.toContain('Repo-map:');
    expect(result).not.toContain('Added src/api.ts');
    expect(result).not.toContain('Dropped src/old.ts');
    expect(result).toContain('I updated the API endpoints.');
  });

  it('strips git output lines', () => {
    const raw = [
      'aider> Refactor the module',
      'Git repo: .git with 150 files',
      'Applied edit to src/module.ts',
      'Commit a1b2c3d Refactor module',
      'The module has been refactored.',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).not.toContain('Git repo:');
    expect(result).not.toContain('Applied edit to');
    expect(result).not.toContain('Commit a1b2c3d');
    expect(result).toContain('refactored');
  });

  it('strips model and version info', () => {
    const raw = [
      'aider v0.50.1',
      'Model: claude-3.5-sonnet',
      'Weak model: claude-3-haiku',
      'aider> Fix the tests',
      'Tests are now passing.',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).not.toContain('aider v0.50');
    expect(result).not.toContain('Model:');
    expect(result).not.toContain('Weak model:');
    expect(result).toContain('Tests are now passing.');
  });

  it('strips "Main model:" line (used when separate weak model configured)', () => {
    const raw = [
      'Main model: claude-3-5-sonnet with diff edit format, prompt cache',
      'Editor model: claude-3-haiku with whole edit format',
      'ask> What does this code do?',
      'It implements a REST API.',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).not.toContain('Main model:');
    expect(result).not.toContain('Editor model:');
    expect(result).toContain('What does this code do?');
    expect(result).toContain('REST API');
  });

  it('strips warning and update notices', () => {
    const raw = [
      'Warning: something happened',
      'Aider v0.51.0 is available',
      'aider> Do the thing',
      'Done.',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).not.toContain('Warning:');
    expect(result).not.toContain('is available');
    expect(result).toContain('Done.');
  });

  it('strips empty prompt lines', () => {
    const raw = [
      'aider>  ',
      'aider> Fix it',
      'Fixed.',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).toContain('Fix it');
    expect(result).toContain('Fixed.');
  });

  it('handles architect mode prompts', () => {
    const raw = [
      'architect> Design the new feature',
      'Here is the design for the new feature.',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).toContain('Design the new feature');
    expect(result).toContain('Here is the design');
  });

  it('extracts only the last turn from multi-turn conversation', () => {
    const raw = [
      'aider> First question',
      'First answer.',
      'aider> Second question',
      'Second answer.',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).toContain('Second question');
    expect(result).toContain('Second answer.');
    expect(result).not.toContain('First question');
  });

  it('returns null for empty input', () => {
    expect(cleanAiderTranscript('')).toBeNull();
    expect(cleanAiderTranscript('   ')).toBeNull();
  });

  it('returns null when only noise remains', () => {
    const raw = [
      'Tokens: 100 sent, 50 received',
      'Model: gpt-4',
      'aider v0.50.1',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).toBeNull();
  });

  it('handles content with no prompt markers', () => {
    const raw = 'Some standalone content without any prompts.';
    const result = cleanAiderTranscript(raw);
    expect(result).toContain('Some standalone content');
  });

  it('strips cost lines', () => {
    const raw = [
      'aider> Fix it',
      '$0.05',
      'Cost: $0.05 total',
      'Done fixing.',
    ].join('\n');

    const result = cleanAiderTranscript(raw);
    expect(result).not.toContain('$0.05');
    expect(result).not.toContain('Cost:');
    expect(result).toContain('Done fixing.');
  });
});

describe('cleanTranscriptForHandoff with aider', () => {
  it('dispatches to aider cleanup', () => {
    const raw = [
      'Tokens: 500 sent',
      'aider> Fix the bug',
      'Bug is fixed.',
    ].join('\n');

    const result = cleanTranscriptForHandoff(raw, 'aider');
    expect(result).not.toContain('Tokens:');
    expect(result).toContain('Fix the bug');
    expect(result).toContain('Bug is fixed.');
  });

  it('returns null for empty input', () => {
    expect(cleanTranscriptForHandoff('', 'aider')).toBeNull();
    expect(cleanTranscriptForHandoff('   ', 'aider')).toBeNull();
  });
});
