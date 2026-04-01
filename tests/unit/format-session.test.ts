import { describe, it, expect } from 'vitest';
import { formatCost, formatDuration } from '../../src/renderer/utils/format-session';

describe('formatCost', () => {
  it('returns $0.00 for NaN', () => {
    expect(formatCost(NaN)).toBe('$0.00');
  });

  it('returns $0.00 for Infinity', () => {
    expect(formatCost(Infinity)).toBe('$0.00');
  });

  it('returns $0.00 for negative Infinity', () => {
    expect(formatCost(-Infinity)).toBe('$0.00');
  });

  it('returns $0.00 for negative values', () => {
    expect(formatCost(-5)).toBe('$0.00');
    expect(formatCost(-0.50)).toBe('$0.00');
  });

  it('returns $0.00 for zero', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('returns <$0.01 for tiny positive values below one cent', () => {
    expect(formatCost(0.001)).toBe('<$0.01');
    expect(formatCost(0.009)).toBe('<$0.01');
  });

  it('formats values at exactly one cent', () => {
    expect(formatCost(0.01)).toBe('$0.01');
  });

  it('formats normal values with two decimal places', () => {
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(42)).toBe('$42.00');
    expect(formatCost(99.99)).toBe('$99.99');
  });

  it('adds thousands separators for large values', () => {
    expect(formatCost(1495.17)).toBe('$1,495.17');
    expect(formatCost(12345.60)).toBe('$12,345.60');
    expect(formatCost(1000000)).toBe('$1,000,000.00');
  });
});

describe('formatDuration', () => {
  it('returns seconds for durations under a minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('returns minutes and seconds for durations under an hour', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3599000)).toBe('59m 59s');
  });

  it('returns hours and minutes for durations over an hour', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
    expect(formatDuration(5400000)).toBe('1h 30m');
    expect(formatDuration(7261000)).toBe('2h 1m');
  });

  it('rounds milliseconds to nearest second', () => {
    expect(formatDuration(1499)).toBe('1s');
    expect(formatDuration(1500)).toBe('2s');
  });
});
