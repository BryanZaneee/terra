import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArchiveView from './ArchiveView';

const mockArchived = [
  {
    photo: { path: '/a.jpg', name: 'a.jpg' },
    days_until_deletion: 10,
  },
  {
    photo: { path: '/b.jpg', name: 'b.jpg' },
    days_until_deletion: 2,
  },
];

describe('ArchiveView', () => {
  it('returns null when not open', () => {
    const { container } = render(
      <ArchiveView isOpen={false} onClose={vi.fn()} archivedPhotos={[]} onRestore={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows empty archive message', () => {
    render(
      <ArchiveView isOpen={true} onClose={vi.fn()} archivedPhotos={[]} onRestore={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(screen.getByText('Archive is empty')).toBeInTheDocument();
  });

  it('shows archived photo count', () => {
    render(
      <ArchiveView isOpen={true} onClose={vi.fn()} archivedPhotos={mockArchived} onRestore={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(screen.getByText(/2 photos in archive/)).toBeInTheDocument();
  });

  it('shows days-until-deletion badges', () => {
    render(
      <ArchiveView isOpen={true} onClose={vi.fn()} archivedPhotos={mockArchived} onRestore={vi.fn()} onRefresh={vi.fn()} />
    );
    expect(screen.getByText('10d left')).toBeInTheDocument();
    expect(screen.getByText('2d left')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(
      <ArchiveView isOpen={true} onClose={onClose} archivedPhotos={[]} onRestore={vi.fn()} onRefresh={vi.fn()} />
    );
    const user = userEvent.setup();
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[buttons.length - 1]);
    expect(onClose).toHaveBeenCalled();
  });
});
