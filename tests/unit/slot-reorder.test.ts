import { describe, it, expect } from 'vitest';
import { computeSlotReorder } from '../../src/renderer/hooks/useBacklogDragDrop';

/** Helper: create items with sequential IDs from a string like "ABCDE" */
function items(ids: string): Array<{ id: string }> {
  return ids.split('').map((id) => ({ id }));
}

/** Helper: extract IDs from result */
function ids(result: string[]): string {
  return result.join('');
}

describe('computeSlotReorder', () => {
  describe('no filters (all items visible)', () => {
    it('reorders all items when no filter is active', () => {
      const allItems = items('ABCDE');
      const display = items('ABCDE');
      // Drag E to the top: new display = [E, A, B, C, D]
      const newDisplay = items('EABCD');
      expect(ids(computeSlotReorder(newDisplay, display, allItems))).toBe('EABCD');
    });

    it('swaps two adjacent items', () => {
      const allItems = items('ABCDE');
      const display = items('ABCDE');
      // Swap B and C
      const newDisplay = items('ACBDE');
      expect(ids(computeSlotReorder(newDisplay, display, allItems))).toBe('ACBDE');
    });

    it('no-op when display order is unchanged', () => {
      const allItems = items('ABCDE');
      const display = items('ABCDE');
      const newDisplay = items('ABCDE');
      expect(ids(computeSlotReorder(newDisplay, display, allItems))).toBe('ABCDE');
    });
  });

  describe('with filters (subset visible)', () => {
    it('preserves hidden items when reordering visible subset', () => {
      // Full list: A B C D E (B and D are hidden by filter)
      const allItems = items('ABCDE');
      const display = items('ACE');
      // Drag E before A: new display = [E, A, C]
      const newDisplay = items('EAC');
      // Hidden items B,D stay in their slots
      expect(ids(computeSlotReorder(newDisplay, display, allItems))).toBe('EBADC');
    });

    it('handles filter with items at start and end hidden', () => {
      // Full list: A B C D E (A and E are hidden)
      const allItems = items('ABCDE');
      const display = items('BCD');
      // Drag D before B: new display = [D, B, C]
      const newDisplay = items('DBC');
      expect(ids(computeSlotReorder(newDisplay, display, allItems))).toBe('ADBCE');
    });

    it('handles single visible item (no-op)', () => {
      const allItems = items('ABCDE');
      const display = items('C');
      const newDisplay = items('C');
      expect(ids(computeSlotReorder(newDisplay, display, allItems))).toBe('ABCDE');
    });

    it('handles two visible items swap', () => {
      // Full list: A B C D E (only B and D visible)
      const allItems = items('ABCDE');
      const display = items('BD');
      // Swap: new display = [D, B]
      const newDisplay = items('DB');
      // Slots 1 and 3 get swapped
      expect(ids(computeSlotReorder(newDisplay, display, allItems))).toBe('ADCBE');
    });

    it('preserves hidden items at consecutive positions', () => {
      // Full list: A B C D E F (C D E hidden, only A B F visible)
      const allItems = items('ABCDEF');
      const display = items('ABF');
      // Drag F before A: new display = [F, A, B]
      const newDisplay = items('FAB');
      expect(ids(computeSlotReorder(newDisplay, display, allItems))).toBe('FACDEB');
    });
  });

  describe('with column sort (display order differs from position order)', () => {
    it('handles sorted display order', () => {
      // Full list by position: A B C D E
      // Column sort shows: C A E (sorted by some column)
      const allItems = items('ABCDE');
      const display = items('CAE');
      // Drag E before C: new display = [E, C, A]
      const newDisplay = items('ECA');
      // Visible slots in full list are at positions 0, 2, 4
      // New assignment: slot 0=E, slot 2=C, slot 4=A
      expect(ids(computeSlotReorder(newDisplay, display, allItems))).toBe('EBCDA');
    });
  });

  describe('with sort + filter combined', () => {
    it('handles both sort and filter active', () => {
      // Full list: A B C D E F G (B D F hidden)
      // Visible: A C E G, sorted by column to: G E C A
      const allItems = items('ABCDEFG');
      const display = items('GECA');
      // Drag A before G: new display = [A, G, E, C]
      const newDisplay = items('AGEC');
      // Visible slots: 0(A), 2(C), 4(E), 6(G)
      // New assignment: slot 0=A, slot 2=G, slot 4=E, slot 6=C
      expect(ids(computeSlotReorder(newDisplay, display, allItems))).toBe('ABGDEFC');
    });
  });

  describe('edge cases', () => {
    it('handles empty lists', () => {
      expect(computeSlotReorder([], [], [])).toEqual([]);
    });

    it('handles all items hidden (empty display)', () => {
      const allItems = items('ABC');
      expect(ids(computeSlotReorder([], [], allItems))).toBe('ABC');
    });

    it('handles single item total', () => {
      const allItems = items('A');
      const display = items('A');
      expect(ids(computeSlotReorder(display, display, allItems))).toBe('A');
    });

    it('result length always equals allItems length', () => {
      const allItems = items('ABCDEFGHIJ');
      const display = items('BDFHJ');
      const newDisplay = items('JHFDB');
      const result = computeSlotReorder(newDisplay, display, allItems);
      expect(result).toHaveLength(allItems.length);
    });

    it('every ID from allItems appears exactly once in result', () => {
      const allItems = items('ABCDEFGHIJ');
      const display = items('BDFHJ');
      const newDisplay = items('JHFDB');
      const result = computeSlotReorder(newDisplay, display, allItems);
      const sorted = [...result].sort();
      expect(sorted).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
    });

    it('hidden items maintain their exact positions', () => {
      const allItems = items('ABCDEFGHIJ');
      const display = items('BDFHJ');
      const newDisplay = items('JHFDB');
      const result = computeSlotReorder(newDisplay, display, allItems);
      // Hidden items: A(0), C(2), E(4), G(6), I(8) must stay at their indices
      expect(result[0]).toBe('A');
      expect(result[2]).toBe('C');
      expect(result[4]).toBe('E');
      expect(result[6]).toBe('G');
      expect(result[8]).toBe('I');
    });
  });
});
