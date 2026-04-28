import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from './Sidebar';

const defaultProps = {
  photos: [],
  viewMode: 'all',
  setViewMode: vi.fn(),
  searchQuery: '',
  handleSearch: vi.fn(),
  albums: [],
  tags: [],
  selectedTagIds: [],
  setSelectedTagIds: vi.fn(),
  smartCollections: [],
  loadSmartCollections: vi.fn(),
  unreviewedCount: 0,
  loading: false,
  uploadStatus: '',
  error: null,
  onUpload: vi.fn(),
  onCreateAlbum: vi.fn(),
  onCreateTag: vi.fn(),
  onSettings: vi.fn(),
  onScanDuplicates: vi.fn(),
  onScanScreenshots: vi.fn(),
  onOpenArchive: vi.fn(),
  onOpenTerraForm: vi.fn(),
  onOpenStorageAnalytics: vi.fn(),
  onOpenImport: vi.fn(),
};

describe('Sidebar', () => {
  it('renders Terra title', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('TERRA')).toBeInTheDocument();
  });

  it('shows photo count when photos exist', () => {
    render(<Sidebar {...defaultProps} photos={[{}, {}, {}]} />);
    expect(screen.getByText('3 photos')).toBeInTheDocument();
  });

  it('shows upload button', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('Upload Photos')).toBeInTheDocument();
  });

  it('calls onUpload when upload button clicked', async () => {
    const onUpload = vi.fn();
    render(<Sidebar {...defaultProps} onUpload={onUpload} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Upload Photos'));
    expect(onUpload).toHaveBeenCalled();
  });

  it('renders view mode buttons', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('All Photos')).toBeInTheDocument();
    expect(screen.getByText('Years')).toBeInTheDocument();
    expect(screen.getByText('Months')).toBeInTheDocument();
    expect(screen.getByText('Locations')).toBeInTheDocument();
    expect(screen.getByText('Favorites')).toBeInTheDocument();
  });

  it('renders cleanup section', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('Find Duplicates')).toBeInTheDocument();
    expect(screen.getByText('Find Screenshots')).toBeInTheDocument();
    expect(screen.getByText('View Archive')).toBeInTheDocument();
  });

  it('shows albums list', () => {
    const albums = [{ id: 1, name: 'Vacation', count: 5 }];
    render(<Sidebar {...defaultProps} albums={albums} />);
    expect(screen.getByText('Vacation')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows empty albums message', () => {
    render(<Sidebar {...defaultProps} albums={[]} />);
    expect(screen.getByText('No albums yet')).toBeInTheDocument();
  });

  it('shows tags list', () => {
    const tags = [{ id: 1, name: 'Nature', color: '#00ff00', count: 3 }];
    render(<Sidebar {...defaultProps} tags={tags} />);
    expect(screen.getByText('Nature')).toBeInTheDocument();
  });

  it('shows unreviewed count badge', () => {
    render(<Sidebar {...defaultProps} unreviewedCount={7} />);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows upload status', () => {
    render(<Sidebar {...defaultProps} uploadStatus="Uploading 3 photos..." />);
    expect(screen.getByText('Uploading 3 photos...')).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(<Sidebar {...defaultProps} error="Upload failed" />);
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
  });

  it('opens provider import from cloud buttons', async () => {
    const onOpenImport = vi.fn();
    render(<Sidebar {...defaultProps} onOpenImport={onOpenImport} />);
    const user = userEvent.setup();

    await user.click(screen.getByText('Google Photos'));
    expect(onOpenImport).toHaveBeenCalledWith('google_photos');

    await user.click(screen.getByText('Snapchat'));
    expect(onOpenImport).toHaveBeenCalledWith('snapchat');
  });
});
