import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SelectionToolbar from './SelectionToolbar';

describe('SelectionToolbar', () => {
  it('shows floating action button when not in selection mode', () => {
    render(
      <SelectionToolbar
        selectionMode={false}
        selectedPhotos={new Set()}
        onAddToAlbum={vi.fn()}
        onTagAssign={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
        onEnterSelectionMode={vi.fn()}
      />
    );
    expect(screen.getByTitle('Select Photos')).toBeInTheDocument();
  });

  it('shows selection count when in selection mode', () => {
    render(
      <SelectionToolbar
        selectionMode={true}
        selectedPhotos={new Set(['a', 'b', 'c'])}
        onAddToAlbum={vi.fn()}
        onTagAssign={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
        onEnterSelectionMode={vi.fn()}
      />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('selected')).toBeInTheDocument();
  });

  it('calls onCancel when Cancel clicked', async () => {
    const onCancel = vi.fn();
    render(
      <SelectionToolbar
        selectionMode={true}
        selectedPhotos={new Set(['a'])}
        onAddToAlbum={vi.fn()}
        onTagAssign={vi.fn()}
        onDelete={vi.fn()}
        onCancel={onCancel}
        onEnterSelectionMode={vi.fn()}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables action buttons when no photos selected', () => {
    render(
      <SelectionToolbar
        selectionMode={true}
        selectedPhotos={new Set()}
        onAddToAlbum={vi.fn()}
        onTagAssign={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
        onEnterSelectionMode={vi.fn()}
      />
    );
    expect(screen.getByText('Add to Album').closest('button')).toBeDisabled();
    expect(screen.getByText('Tag').closest('button')).toBeDisabled();
    expect(screen.getByText('Delete').closest('button')).toBeDisabled();
  });
});
