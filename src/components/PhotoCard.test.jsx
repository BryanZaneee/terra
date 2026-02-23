import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhotoCard from './PhotoCard';

const mockPhoto = {
  id: '/pics/sunset.jpg',
  url: 'asset://localhost/pics/sunset.jpg',
  name: 'sunset.jpg',
  date: 1700000000,
  path: '/pics/sunset.jpg',
  is_favorite: true,
  mediaType: 'photo',
};

describe('PhotoCard', () => {
  it('renders thumbnail image', () => {
    render(
      <PhotoCard
        photo={mockPhoto}
        isSelected={false}
        selectionMode={false}
        onPhotoClick={vi.fn()}
        onToggleSelection={vi.fn()}
      />
    );
    expect(screen.getByAltText('sunset.jpg')).toBeInTheDocument();
  });

  it('shows favorite indicator when favorite and not in selection mode', () => {
    const { container } = render(
      <PhotoCard
        photo={mockPhoto}
        isSelected={false}
        selectionMode={false}
        onPhotoClick={vi.fn()}
        onToggleSelection={vi.fn()}
      />
    );
    // Heart icon for favorite
    expect(container.querySelector('.text-red-500')).toBeInTheDocument();
  });

  it('applies selection border when selected', () => {
    const { container } = render(
      <PhotoCard
        photo={mockPhoto}
        isSelected={true}
        selectionMode={true}
        onPhotoClick={vi.fn()}
        onToggleSelection={vi.fn()}
      />
    );
    const card = container.firstChild;
    expect(card.className).toContain('border-emerald-500');
  });

  it('shows video play icon for video type', () => {
    const videoPhoto = { ...mockPhoto, mediaType: 'video' };
    const { container } = render(
      <PhotoCard
        photo={videoPhoto}
        isSelected={false}
        selectionMode={false}
        onPhotoClick={vi.fn()}
        onToggleSelection={vi.fn()}
      />
    );
    // Play icon container
    expect(container.querySelector('.fill-white')).toBeInTheDocument();
  });

  it('calls onPhotoClick when card is clicked', async () => {
    const onPhotoClick = vi.fn();
    render(
      <PhotoCard
        photo={mockPhoto}
        isSelected={false}
        selectionMode={false}
        onPhotoClick={onPhotoClick}
        onToggleSelection={vi.fn()}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByAltText('sunset.jpg'));
    expect(onPhotoClick).toHaveBeenCalled();
  });
});
