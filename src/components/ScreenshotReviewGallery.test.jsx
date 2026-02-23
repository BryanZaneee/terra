import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScreenshotReviewGallery from './ScreenshotReviewGallery';

const mockScreenshots = [
  { path: '/s1.png', name: 'screenshot1.png' },
  { path: '/s2.png', name: 'screenshot2.png' },
];

describe('ScreenshotReviewGallery', () => {
  it('returns null when not open', () => {
    const { container } = render(
      <ScreenshotReviewGallery isOpen={false} onClose={vi.fn()} screenshots={[]} onArchive={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows no screenshots message when empty', () => {
    render(
      <ScreenshotReviewGallery isOpen={true} onClose={vi.fn()} screenshots={[]} onArchive={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(screen.getByText('No screenshots found!')).toBeInTheDocument();
  });

  it('shows screenshot count', () => {
    render(
      <ScreenshotReviewGallery isOpen={true} onClose={vi.fn()} screenshots={mockScreenshots} onArchive={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(screen.getByText('2 screenshots detected')).toBeInTheDocument();
  });

  it('has Select All and Select None buttons', () => {
    render(
      <ScreenshotReviewGallery isOpen={true} onClose={vi.fn()} screenshots={mockScreenshots} onArchive={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(screen.getByText('Select All')).toBeInTheDocument();
    expect(screen.getByText('Select None')).toBeInTheDocument();
  });
});
