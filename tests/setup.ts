import { vi, beforeEach, afterEach } from 'vitest';
import { config } from 'dotenv';

// Load .env file for local development
config();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
