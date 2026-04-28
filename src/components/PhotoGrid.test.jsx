import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PhotoGrid from './PhotoGrid';

const mockPhotos = [
  { id: '/p/1.jpg', url: 'asset://1', name: '1.jpg', date: 1700000000, path: '/p/1.jpg', is_favorite: false, mediaType: 'photo' },
];

const mockGrouped = [['All Photos', mockPhotos]];

const defaultProps = {
  loading: false,
  photos: [],
  groupedPhotos: [],
  expandedGroups: {},
  toggleGroup: vi.fn(),
  selectedPhotos: new Set(),
  selectionMode: false,
  onPhotoClick: vi.fn(),
  onToggleSelection: vi.fn(),
  uploadStatus: '',
};

describe('PhotoGrid', () => {
  it('shows skeleton grid on initial load (loading=true, no photos)', () => {
    const { container } = render(
      <PhotoGrid
        {...defaultProps}
        loading={true}
        photos={[]}
        groupedPhotos={[]}
      />
    );
    // SkeletonGrid renders a grid of skeleton cards; spinner text is gone
    expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
    const grid = container.querySelector('.grid');
    expect(grid).toBeTruthy();
    // default rows=3, cols=5 → 15 skeleton cards
    expect(grid.children.length).toBe(15);
  });

  it('keeps photos visible on refresh (loading=true, photos exist)', () => {
    render(
      <PhotoGrid
        {...defaultProps}
        loading={true}
        photos={mockPhotos}
        groupedPhotos={mockGrouped}
        expandedGroups={{ 'All Photos': true }}
      />
    );
    // Real photos remain rendered — no skeleton takeover
    expect(screen.getByAltText('1.jpg')).toBeInTheDocument();
    expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
  });

  it('shows status pill during refresh when uploadStatus is set', () => {
    render(
      <PhotoGrid
        {...defaultProps}
        loading={true}
        photos={mockPhotos}
        groupedPhotos={mockGrouped}
        expandedGroups={{ 'All Photos': true }}
        uploadStatus="Uploading 3 photos..."
      />
    );
    expect(screen.getByText('Uploading 3 photos...')).toBeInTheDocument();
  });

  it('shows empty state when no photos and not loading', () => {
    render(
      <PhotoGrid
        {...defaultProps}
        loading={false}
        photos={[]}
        groupedPhotos={[]}
      />
    );
    expect(screen.getByText(/No photos in library yet/)).toBeInTheDocument();
  });

  it('renders grouped photos', () => {
    render(
      <PhotoGrid
        {...defaultProps}
        loading={false}
        photos={mockPhotos}
        groupedPhotos={mockGrouped}
        expandedGroups={{ 'All Photos': true }}
      />
    );
    expect(screen.getByText('All Photos')).toBeInTheDocument();
    expect(screen.getByText('1 items')).toBeInTheDocument();
    expect(screen.getByAltText('1.jpg')).toBeInTheDocument();
  });

  it('hides photos when group is collapsed', () => {
    render(
      <PhotoGrid
        {...defaultProps}
        loading={false}
        photos={mockPhotos}
        groupedPhotos={mockGrouped}
        expandedGroups={{ 'All Photos': false }}
      />
    );
    expect(screen.getByText('All Photos')).toBeInTheDocument();
    expect(screen.queryByAltText('1.jpg')).not.toBeInTheDocument();
  });
});
