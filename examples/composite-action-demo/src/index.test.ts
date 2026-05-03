import { expect, it } from 'vitest';
import { greeting } from './index.js';

it('greets', () => expect(greeting('rehearse')).toBe('hello rehearse'));
