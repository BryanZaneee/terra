import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhotoModal from './PhotoModal';

const mockPhoto = {
  name: 'sunset.jpg',
  url: 'asset://localhost/pics/sunset.jpg',
  date: 1700000000,
  path: '/pics/sunset.jpg',
  is_favorite: false,
  mediaType: 'photo',
  width: 4000,
  height: 3000,
  file_size: 2500000,
  source_type: 'managed',
};

const mockVideo = {
  ...mockPhoto,
  name: 'clip.mp4',
  mediaType: 'video',
};

const mockPhotos = [
  { ...mockPhoto, path: '/pics/a.jpg', name: 'a.jpg' },
  { ...mockPhoto, path: '/pics/sunset.jpg', name: 'sunset.jpg' },
  { ...mockPhoto, path: '/pics/b.jpg', name: 'b.jpg' },
];

const defaultProps = {
  photo: mockPhoto,
  photos: [mockPhoto],
  onClose: vi.fn(),
  onToggleFavorite: vi.fn(),
  onSelectPhoto: vi.fn(),
  onArchive: vi.fn(),
  onDelete: vi.fn(),
  onAddToAlbum: vi.fn(),
  onTagAssign: vi.fn(),
  onReveal: vi.fn(),
};

describe('PhotoModal', () => {
  it('returns null when no photo', () => {
    const { container } = render(
      <PhotoModal photo={null} onClose={vi.fn()} onToggleFavorite={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders photo image', () => {
    render(<PhotoModal {...defaultProps} />);
    expect(screen.getByAltText('sunset.jpg')).toBeInTheDocument();
    expect(screen.getAllByText('sunset.jpg').length).toBeGreaterThan(0);
  });

  it('shows filename in action bar', () => {
    render(<PhotoModal {...defaultProps} />);
    expect(screen.getAllByText('sunset.jpg').length).toBeGreaterThan(0);
  });

  it('shows VIDEO badge for video media type', () => {
    render(<PhotoModal {...defaultProps} photo={mockVideo} />);
    expect(screen.getByText('VIDEO')).toBeInTheDocument();
  });

  it('calls onClose when X button clicked', async () => {
    const onClose = vi.fn();
    render(<PhotoModal {...defaultProps} onClose={onClose} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Close (Esc)'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<PhotoModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onToggleFavorite when Favorite button clicked', async () => {
    const onToggleFavorite = vi.fn();
    render(<PhotoModal {...defaultProps} onToggleFavorite={onToggleFavorite} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Favorite (F)'));
    expect(onToggleFavorite).toHaveBeenCalledWith(mockPhoto);
  });

  it('calls onToggleFavorite on f key', () => {
    const onToggleFavorite = vi.fn();
    render(<PhotoModal {...defaultProps} onToggleFavorite={onToggleFavorite} />);
    fireEvent.keyDown(window, { key: 'f' });
    expect(onToggleFavorite).toHaveBeenCalledWith(mockPhoto);
  });

  it('toggles info drawer on Info button click', async () => {
    render(<PhotoModal {...defaultProps} />);
    const user = userEvent.setup();
    // Drawer starts closed (aria-hidden="true")
    const drawer = screen.getByText('Photo Info').closest('[aria-hidden]');
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
    await user.click(screen.getByLabelText('Info (I)'));
    expect(drawer).toHaveAttribute('aria-hidden', 'false');
  });

  it('toggles info drawer on i key', () => {
    render(<PhotoModal {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'i' });
    const drawer = screen.getByText('Photo Info').closest('[aria-hidden]');
    expect(drawer).toHaveAttribute('aria-hidden', 'false');
  });

  it('navigates to next photo on ArrowRight', () => {
    const onSelectPhoto = vi.fn();
    render(
      <PhotoModal
        {...defaultProps}
        photo={mockPhotos[0]}
        photos={mockPhotos}
        onSelectPhoto={onSelectPhoto}
      />
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onSelectPhoto).toHaveBeenCalledWith(mockPhotos[1]);
  });

  it('navigates to prev photo on ArrowLeft', () => {
    const onSelectPhoto = vi.fn();
    render(
      <PhotoModal
        {...defaultProps}
        photo={mockPhotos[2]}
        photos={mockPhotos}
        onSelectPhoto={onSelectPhoto}
      />
    );
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onSelectPhoto).toHaveBeenCalledWith(mockPhotos[1]);
  });

  it('navigates on j / k keys', () => {
    const onSelectPhoto = vi.fn();
    render(
      <PhotoModal
        {...defaultProps}
        photo={mockPhotos[0]}
        photos={mockPhotos}
        onSelectPhoto={onSelectPhoto}
      />
    );
    fireEvent.keyDown(window, { key: 'j' });
    expect(onSelectPhoto).toHaveBeenCalledWith(mockPhotos[1]);
  });

  it('calls onArchive on Delete key', () => {
    const onArchive = vi.fn();
    render(<PhotoModal {...defaultProps} onArchive={onArchive} />);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onArchive).toHaveBeenCalledWith(mockPhoto);
  });

  it('calls onArchive when Archive button clicked', async () => {
    const onArchive = vi.fn();
    render(<PhotoModal {...defaultProps} onArchive={onArchive} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Archive (Delete)'));
    expect(onArchive).toHaveBeenCalledWith(mockPhoto);
  });

  it('calls onReveal on o key', () => {
    const onReveal = vi.fn();
    render(<PhotoModal {...defaultProps} onReveal={onReveal} />);
    fireEvent.keyDown(window, { key: 'o' });
    expect(onReveal).toHaveBeenCalledWith(mockPhoto);
  });

  it('calls onReveal when Reveal button clicked', async () => {
    const onReveal = vi.fn();
    render(<PhotoModal {...defaultProps} onReveal={onReveal} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Reveal in Finder (O)'));
    expect(onReveal).toHaveBeenCalledWith(mockPhoto);
  });

  it('calls onDelete when Delete button clicked', async () => {
    const onDelete = vi.fn();
    render(<PhotoModal {...defaultProps} onDelete={onDelete} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Delete Permanently (⌘⌫)'));
    expect(onDelete).toHaveBeenCalledWith(mockPhoto);
  });

  it('calls onAddToAlbum when Add to Album button clicked', async () => {
    const onAddToAlbum = vi.fn();
    render(<PhotoModal {...defaultProps} onAddToAlbum={onAddToAlbum} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Add to Album'));
    expect(onAddToAlbum).toHaveBeenCalledWith(mockPhoto);
  });

  it('calls onTagAssign when Tag button clicked', async () => {
    const onTagAssign = vi.fn();
    render(<PhotoModal {...defaultProps} onTagAssign={onTagAssign} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Tag'));
    expect(onTagAssign).toHaveBeenCalledWith(mockPhoto);
  });

  it('info drawer shows photo metadata', async () => {
    render(<PhotoModal {...defaultProps} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Info (I)'));
    // name appears in both action bar and drawer
    expect(screen.getAllByText('sunset.jpg').length).toBeGreaterThan(0);
    expect(screen.getByText('4000 × 3000')).toBeInTheDocument();
    expect(screen.getByText('2.4 MB')).toBeInTheDocument();
    expect(screen.getByText('managed')).toBeInTheDocument();
  });

  it('shows GPS link when coordinates present', async () => {
    const photo = { ...mockPhoto, latitude: 37.7749, longitude: -122.4194 };
    render(<PhotoModal {...defaultProps} photo={photo} />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Info (I)'));
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', expect.stringContaining('maps.apple.com'));
  });
});
