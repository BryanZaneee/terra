import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateAlbumModal from './CreateAlbumModal';

describe('CreateAlbumModal', () => {
  it('returns null when not open', () => {
    const { container } = render(
      <CreateAlbumModal isOpen={false} onClose={vi.fn()} onCreate={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders form when open', () => {
    render(
      <CreateAlbumModal isOpen={true} onClose={vi.fn()} onCreate={vi.fn()} />
    );
    expect(screen.getByText('Create New Album')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Album Name')).toBeInTheDocument();
  });

  it('calls onCreate on form submit with non-empty name', async () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateAlbumModal isOpen={true} onClose={onClose} onCreate={onCreate} />
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Album Name'), 'My Vacation');
    await user.click(screen.getByText('Create Album'));

    expect(onCreate).toHaveBeenCalledWith('My Vacation');
    expect(onClose).toHaveBeenCalled();
  });

  it('disables submit button when name is empty', () => {
    render(
      <CreateAlbumModal isOpen={true} onClose={vi.fn()} onCreate={vi.fn()} />
    );
    expect(screen.getByText('Create Album')).toBeDisabled();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    render(
      <CreateAlbumModal isOpen={true} onClose={onClose} onCreate={vi.fn()} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
