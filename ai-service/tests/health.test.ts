import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

describe('ai-service app', () => {
  it('creates an express app', () => {
    expect(createApp()).toBeDefined();
  });
});
