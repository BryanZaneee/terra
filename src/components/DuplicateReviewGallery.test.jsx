import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DuplicateReviewGallery from './DuplicateReviewGallery';

const mockGroups = [
  {
    group_id: 1,
    group_type: 'exact',
    similarity_score: 1.0,
    photos: [
      { path: '/a.jpg', name: 'a.jpg', width: 1920, height: 1080, date_taken: 1700000000 },
      { path: '/b.jpg', name: 'b.jpg', width: 1920, height: 1080, date_taken: 1700000000 },
    ],
  },
];

describe('DuplicateReviewGallery', () => {
  it('returns null when not open', () => {
    const { container } = render(
      <DuplicateReviewGallery isOpen={false} onClose={vi.fn()} duplicateGroups={[]} onArchive={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows no duplicates message when empty', () => {
    render(
      <DuplicateReviewGallery isOpen={true} onClose={vi.fn()} duplicateGroups={[]} onArchive={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(screen.getByText('No duplicates found!')).toBeInTheDocument();
  });

  it('shows duplicate group count', () => {
    render(
      <DuplicateReviewGallery isOpen={true} onClose={vi.fn()} duplicateGroups={mockGroups} onArchive={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(screen.getByText('1 duplicate groups found')).toBeInTheDocument();
    expect(screen.getByText('Exact Match')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(
      <DuplicateReviewGallery isOpen={true} onClose={onClose} duplicateGroups={mockGroups} onArchive={vi.fn()} onRefresh={vi.fn()} />
    );
    const user = userEvent.setup();
    const buttons = screen.getAllByRole('button');
    // Last button is close (X)
    await user.click(buttons[buttons.length - 1]);
    expect(onClose).toHaveBeenCalled();
  });
});
