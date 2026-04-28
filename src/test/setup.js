import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  convertFileSrc: vi.fn((path) => `asset://localhost/${encodeURIComponent(path)}`),
}));

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock @tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

// Mock HTMLVideoElement.play/pause (jsdom doesn't implement them)
HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
HTMLVideoElement.prototype.pause = vi.fn();
HTMLVideoElement.prototype.load = vi.fn();

// jsdom doesn't implement ResizeObserver; react-virtuoso uses it for sizing.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver || ResizeObserverStub;
