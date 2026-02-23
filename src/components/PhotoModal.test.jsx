import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhotoModal from './PhotoModal';

const mockPhoto = {
  name: 'sunset.jpg',
  url: 'asset://localhost/pics/sunset.jpg',
  date: 1700000000,
  path: '/pics/sunset.jpg',
  is_favorite: false,
  mediaType: 'photo',
};

const mockVideo = {
  ...mockPhoto,
  name: 'clip.mp4',
  mediaType: 'video',
};

describe('PhotoModal', () => {
  it('returns null when no photo', () => {
    const { container } = render(
      <PhotoModal photo={null} onClose={vi.fn()} onToggleFavorite={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders photo image', () => {
    render(
      <PhotoModal photo={mockPhoto} onClose={vi.fn()} onToggleFavorite={vi.fn()} />
    );
    expect(screen.getByAltText('sunset.jpg')).toBeInTheDocument();
    expect(screen.getByText('sunset.jpg')).toBeInTheDocument();
  });

  it('shows VIDEO badge for video media type', () => {
    render(
      <PhotoModal photo={mockVideo} onClose={vi.fn()} onToggleFavorite={vi.fn()} />
    );
    expect(screen.getByText('VIDEO')).toBeInTheDocument();
  });

  it('calls onToggleFavorite when heart clicked', async () => {
    const onToggleFavorite = vi.fn();
    render(
      <PhotoModal photo={mockPhoto} onClose={vi.fn()} onToggleFavorite={onToggleFavorite} />
    );

    const user = userEvent.setup();
    // Find the heart button (second button in the modal after close)
    const buttons = screen.getAllByRole('button');
    // The favorite button is in the info area
    const favButton = buttons.find(b => b.closest('.rounded-full') && !b.querySelector('[data-testid]'));
    // Click the second button (first is close, second is favorite)
    await user.click(buttons[1]);
    expect(onToggleFavorite).toHaveBeenCalledWith(mockPhoto);
  });

  it('calls onClose when X clicked', async () => {
    const onClose = vi.fn();
    render(
      <PhotoModal photo={mockPhoto} onClose={onClose} onToggleFavorite={vi.fn()} />
    );

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button')[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
