import { useEffect, useState } from 'react';

const BREAKPOINTS = [
  { min: 1280, cols: 5 },
  { min: 1024, cols: 4 },
  { min: 768, cols: 3 },
  { min: 0, cols: 2 },
];

function pickColumns(width) {
  for (const bp of BREAKPOINTS) {
    if (width >= bp.min) return bp.cols;
  }
  return 2;
}

export function useResponsiveColumns() {
  const [cols, setCols] = useState(() =>
    typeof window === 'undefined' ? 5 : pickColumns(window.innerWidth)
  );

  useEffect(() => {
    const onResize = () => setCols(pickColumns(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return cols;
}
