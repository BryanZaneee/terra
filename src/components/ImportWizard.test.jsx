import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportWizard from './ImportWizard';

const { invoke } = await import('@tauri-apps/api/core');
const { open } = await import('@tauri-apps/plugin-dialog');

describe('ImportWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    open.mockResolvedValue(null);
    invoke.mockResolvedValue({
      provider_id: 'google_photos',
      provider_label: 'Google Photos',
      discovered: 3,
      imported: 2,
      skipped_duplicates: 1,
      unsupported: 0,
      failed: 0,
      imported_photos: [],
    });
  });

  it('shows Google Takeout guidance by default', () => {
    render(<ImportWizard isOpen onClose={vi.fn()} initialProviderId="google_photos" />);

    expect(screen.getByRole('heading', { name: 'Google Photos' })).toBeInTheDocument();
    expect(screen.getByText('Open Google Takeout')).toBeInTheDocument();
    expect(screen.getByText('Choose Folder')).toBeInTheDocument();
    expect(screen.getByText('Choose ZIP')).toBeInTheDocument();
  });

  it('switches provider guidance', async () => {
    render(<ImportWizard isOpen onClose={vi.fn()} initialProviderId="google_photos" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Snapchat' }));

    expect(screen.getByText('Download Snapchat data')).toBeInTheDocument();
    expect(screen.getByText(/Snapchat does not provide/)).toBeInTheDocument();
  });

  it('imports a selected folder through Tauri', async () => {
    const onImportComplete = vi.fn();
    open.mockResolvedValue('/tmp/google-takeout');

    render(
      <ImportWizard
        isOpen
        onClose={vi.fn()}
        initialProviderId="google_photos"
        onImportComplete={onImportComplete}
      />
    );
    const user = userEvent.setup();

    await user.click(screen.getByText('Choose Folder'));

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
      expect(invoke).toHaveBeenCalledWith('import_provider_export', {
        providerId: 'google_photos',
        sourcePath: '/tmp/google-takeout',
      });
      expect(onImportComplete).toHaveBeenCalled();
    });
    expect(screen.getByText('Import complete')).toBeInTheDocument();
    expect(screen.getByText('Imported')).toBeInTheDocument();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });
});
