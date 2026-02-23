import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddToAlbumModal from './AddToAlbumModal';

const mockAlbums = [
  { id: 1, name: 'Vacation', cover_photo_path: null, count: 5 },
  { id: 2, name: 'Family', cover_photo_path: null, count: 12 },
];

describe('AddToAlbumModal', () => {
  it('returns null when not open', () => {
    const { container } = render(
      <AddToAlbumModal isOpen={false} onClose={vi.fn()} albums={[]} onSelect={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders album list when open', () => {
    render(
      <AddToAlbumModal isOpen={true} onClose={vi.fn()} albums={mockAlbums} onSelect={vi.fn()} />
    );
    expect(screen.getByText('Vacation')).toBeInTheDocument();
    expect(screen.getByText('Family')).toBeInTheDocument();
    expect(screen.getByText('5 items')).toBeInTheDocument();
  });

  it('calls onSelect with album id when clicked', async () => {
    const onSelect = vi.fn();
    render(
      <AddToAlbumModal isOpen={true} onClose={vi.fn()} albums={mockAlbums} onSelect={onSelect} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByText('Vacation'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
