import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhotoCardSkeleton, SkeletonGrid } from './Skeleton';

describe('PhotoCardSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<PhotoCardSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });
});

describe('SkeletonGrid', () => {
  it('renders without crashing using defaults', () => {
    const { container } = render(<SkeletonGrid />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders the correct number of skeleton cards', () => {
    const { container } = render(<SkeletonGrid rows={2} cols={3} />);
    // 2 rows * 3 cols = 6 skeleton cards inside the grid div
    const grid = container.querySelector('.grid');
    expect(grid.children.length).toBe(6);
  });
});
