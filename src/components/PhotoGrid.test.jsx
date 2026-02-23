import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PhotoGrid from './PhotoGrid';

const mockPhotos = [
  { id: '/p/1.jpg', url: 'asset://1', name: '1.jpg', date: 1700000000, path: '/p/1.jpg', is_favorite: false, mediaType: 'photo' },
];

const mockGrouped = [['All Photos', mockPhotos]];

describe('PhotoGrid', () => {
  it('shows loading spinner when loading', () => {
    render(
      <PhotoGrid
        loading={true}
        photos={[]}
        groupedPhotos={[]}
        expandedGroups={{}}
        toggleGroup={vi.fn()}
        selectedPhotos={new Set()}
        selectionMode={false}
        onPhotoClick={vi.fn()}
        onToggleSelection={vi.fn()}
        uploadStatus=""
      />
    );
    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('shows empty state when no photos', () => {
    render(
      <PhotoGrid
        loading={false}
        photos={[]}
        groupedPhotos={[]}
        expandedGroups={{}}
        toggleGroup={vi.fn()}
        selectedPhotos={new Set()}
        selectionMode={false}
        onPhotoClick={vi.fn()}
        onToggleSelection={vi.fn()}
        uploadStatus=""
      />
    );
    expect(screen.getByText(/No photos in library yet/)).toBeInTheDocument();
  });

  it('renders grouped photos', () => {
    render(
      <PhotoGrid
        loading={false}
        photos={mockPhotos}
        groupedPhotos={mockGrouped}
        expandedGroups={{ 'All Photos': true }}
        toggleGroup={vi.fn()}
        selectedPhotos={new Set()}
        selectionMode={false}
        onPhotoClick={vi.fn()}
        onToggleSelection={vi.fn()}
        uploadStatus=""
      />
    );
    expect(screen.getByText('All Photos')).toBeInTheDocument();
    expect(screen.getByText('1 items')).toBeInTheDocument();
    expect(screen.getByAltText('1.jpg')).toBeInTheDocument();
  });

  it('hides photos when group is collapsed', () => {
    render(
      <PhotoGrid
        loading={false}
        photos={mockPhotos}
        groupedPhotos={mockGrouped}
        expandedGroups={{ 'All Photos': false }}
        toggleGroup={vi.fn()}
        selectedPhotos={new Set()}
        selectionMode={false}
        onPhotoClick={vi.fn()}
        onToggleSelection={vi.fn()}
        uploadStatus=""
      />
    );
    expect(screen.getByText('All Photos')).toBeInTheDocument();
    expect(screen.queryByAltText('1.jpg')).not.toBeInTheDocument();
  });
});
