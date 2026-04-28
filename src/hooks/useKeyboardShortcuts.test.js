import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function fireKey(key, options = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  vi.spyOn(event, 'preventDefault');
  document.dispatchEvent(event);
  return event;
}

function fireKeyOnTarget(target, key, options = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...options });
  Object.defineProperty(event, 'target', { value: target });
  document.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  let onFocusSearch;
  let onCycleViewMode;
  let onCloseTopModal;

  beforeEach(() => {
    onFocusSearch = vi.fn();
    onCycleViewMode = vi.fn();
    onCloseTopModal = vi.fn();
  });

  function render(overrides = {}) {
    return renderHook(() =>
      useKeyboardShortcuts({
        onFocusSearch,
        onCycleViewMode,
        onCloseTopModal,
        ...overrides,
      })
    );
  }

  it('pressing "/" calls onFocusSearch and prevents default', () => {
    render();
    const event = fireKey('/');
    expect(onFocusSearch).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('pressing "g" calls onCycleViewMode', () => {
    render();
    fireKey('g');
    expect(onCycleViewMode).toHaveBeenCalledTimes(1);
  });

  it('pressing Escape calls onCloseTopModal', () => {
    render();
    fireKey('Escape');
    expect(onCloseTopModal).toHaveBeenCalledTimes(1);
  });

  it('pressing "/" inside an input does not call onFocusSearch', () => {
    render();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireKeyOnTarget(input, '/');
    expect(onFocusSearch).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('pressing "/" inside a textarea does not call onFocusSearch', () => {
    render();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    fireKeyOnTarget(textarea, '/');
    expect(onFocusSearch).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it('pressing Cmd+G does not call onCycleViewMode', () => {
    render();
    fireKey('g', { metaKey: true });
    expect(onCycleViewMode).not.toHaveBeenCalled();
  });

  it('pressing Ctrl+G does not call onCycleViewMode', () => {
    render();
    fireKey('g', { ctrlKey: true });
    expect(onCycleViewMode).not.toHaveBeenCalled();
  });

  it('setting enabled=false detaches listeners', () => {
    render({ enabled: false });
    fireKey('/');
    fireKey('g');
    fireKey('Escape');
    expect(onFocusSearch).not.toHaveBeenCalled();
    expect(onCycleViewMode).not.toHaveBeenCalled();
    expect(onCloseTopModal).not.toHaveBeenCalled();
  });

  it('pressing a key after unmount calls nothing', () => {
    const { unmount } = render();
    unmount();
    fireKey('/');
    fireKey('g');
    fireKey('Escape');
    expect(onFocusSearch).not.toHaveBeenCalled();
    expect(onCycleViewMode).not.toHaveBeenCalled();
    expect(onCloseTopModal).not.toHaveBeenCalled();
  });
});
