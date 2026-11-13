import { describe, expect, it } from 'vitest';
import { memoryIdOf } from '../src/ui/chat/ToolMemoryTitle';

describe('memoryIdOf', () => {
  it('finds the id a memory read, update or delete names, by its wire name or its own', () => {
    expect(memoryIdOf('memory__read', { id: ' m-abc123 ' })).toBe('m-abc123');
    expect(memoryIdOf('memory.delete', { id: 'm-abc123' })).toBe('m-abc123');
    expect(memoryIdOf('memory__save', { id: 'm-abc123', text: 'x' })).toBe('m-abc123');
  });
  it('finds none for a new item, another tool or no id', () => {
    expect(memoryIdOf('memory__save', { title: 'New', text: 'x' })).toBeUndefined();
    expect(memoryIdOf('memory__search', { query: 'm-abc123' })).toBeUndefined();
    expect(memoryIdOf('tabs__read', { id: 'm-abc123' })).toBeUndefined();
    expect(memoryIdOf('memory__read', { id: '' })).toBeUndefined();
    expect(memoryIdOf('memory__read', null)).toBeUndefined();
  });
});
