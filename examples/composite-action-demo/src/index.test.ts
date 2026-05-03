import { expect, it } from 'vitest';
import { greeting } from './index.js';

it('greets', () => expect(greeting('gitgate')).toBe('hello gitgate'));
