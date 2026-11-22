import { describe, expect, it } from 'vitest';
import { pressureReason, withPressureReason } from './extra';

describe('pressure reason', () => {
  it('stores a tidied reason and keeps other extra fields', () => {
    const extra = withPressureReason({ other: 1 }, '  Quarterly   deadline ');
    expect(extra).toEqual({ other: 1, pressure_reason: 'Quarterly deadline' });
    expect(pressureReason({ extra })).toBe('Quarterly deadline');
  });
  it('removes it when blank', () => {
    expect(withPressureReason({ pressure_reason: 'x', other: 1 }, '   ')).toEqual({ other: 1 });
    expect(pressureReason({ extra: {} })).toBeNull();
    expect(pressureReason({ extra: { pressure_reason: 42 } })).toBeNull();
  });
});
