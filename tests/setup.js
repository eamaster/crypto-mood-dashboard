import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock global fetch if needed
global.fetch = global.fetch || vi.fn();

