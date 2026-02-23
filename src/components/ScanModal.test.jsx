import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanModal from './ScanModal';
import { Copy } from 'lucide-react';

describe('ScanModal', () => {
  it('returns null when not open', () => {
    const { container } = render(
      <ScanModal isOpen={false} onClose={vi.fn()} title="Test" progress={{ total: 0, processed: 0 }} phase="" icon={Copy} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows progress percentage', () => {
    render(
      <ScanModal isOpen={true} onClose={vi.fn()} title="Scanning" progress={{ total: 100, processed: 50 }} phase="hashing" icon={Copy} />
    );
    expect(screen.getByText('50 / 100 photos')).toBeInTheDocument();
    expect(screen.getByText('Analyzing photos...')).toBeInTheDocument();
  });

  it('shows phase text for each phase', () => {
    const { rerender } = render(
      <ScanModal isOpen={true} onClose={vi.fn()} title="Scan" progress={{ total: 10, processed: 5 }} phase="analyzing" icon={Copy} />
    );
    expect(screen.getByText('Detecting patterns...')).toBeInTheDocument();

    rerender(
      <ScanModal isOpen={true} onClose={vi.fn()} title="Scan" progress={{ total: 10, processed: 10 }} phase="complete" icon={Copy} />
    );
    expect(screen.getByText('Scan complete!')).toBeInTheDocument();
    expect(screen.getByText('View Results')).toBeInTheDocument();
  });

  it('calls onClose when View Results clicked', async () => {
    const onClose = vi.fn();
    render(
      <ScanModal isOpen={true} onClose={onClose} title="Scan" progress={{ total: 10, processed: 10 }} phase="complete" icon={Copy} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByText('View Results'));
    expect(onClose).toHaveBeenCalled();
  });
});
