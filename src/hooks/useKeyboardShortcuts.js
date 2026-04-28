import { useEffect, useRef } from 'react';

function isTextInput(target) {
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

export function useKeyboardShortcuts({
  onFocusSearch,
  onCycleViewMode,
  onCloseTopModal,
  enabled = true,
}) {
  // Refs prevent re-attaching the listener on every render when callbacks change.
  const onFocusSearchRef = useRef(onFocusSearch);
  const onCycleViewModeRef = useRef(onCycleViewMode);
  const onCloseTopModalRef = useRef(onCloseTopModal);

  useEffect(() => { onFocusSearchRef.current = onFocusSearch; }, [onFocusSearch]);
  useEffect(() => { onCycleViewModeRef.current = onCycleViewMode; }, [onCycleViewMode]);
  useEffect(() => { onCloseTopModalRef.current = onCloseTopModal; }, [onCloseTopModal]);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e) {
      if (isTextInput(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      if (key === '/') {
        e.preventDefault();
        onFocusSearchRef.current?.();
      } else if (key === 'g' || key === 'G') {
        onCycleViewModeRef.current?.();
      } else if (key === 'Escape') {
        onCloseTopModalRef.current?.();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
