import type { ExternalSource, ImportCheckCliResult, ImportFetchInput, ImportFetchResult } from '../../../../shared/types';
import type { BoardAdapter, AdapterStatus, DownloadedAttachment, PrerequisiteResult } from '../../shared';

const NOT_IMPLEMENTED = 'Asana adapter is not yet implemented (tracked in #480).';

export class AsanaAdapter implements BoardAdapter {
  readonly id: ExternalSource = 'asana';
  readonly displayName = 'Asana';
  readonly icon = 'circle-dot';
  readonly status: AdapterStatus = 'stub';

  async checkPrerequisites(): Promise<PrerequisiteResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async checkCli(): Promise<ImportCheckCliResult> {
    return { available: false, authenticated: false, error: NOT_IMPLEMENTED };
  }

  async fetch(
    _input: ImportFetchInput,
    _findAlreadyImported: (source: ExternalSource, externalIds: string[]) => Set<string>,
  ): Promise<ImportFetchResult> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async downloadImages(_markdownBody: string): Promise<{ attachments: DownloadedAttachment[]; skippedCount: number }> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
