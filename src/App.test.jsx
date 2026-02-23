import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

// Mock canvas getContext for DitherBackground
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn(() => ({ width: 10 })),
  font: '',
  fillStyle: '',
  textBaseline: '',
}));

describe('App integration', () => {
  it('renders without crashing', async () => {
    const { container } = render(<App />);
    // Should render the Terra title in the sidebar
    expect(screen.getByText('TERRA')).toBeInTheDocument();
    // Should render the main layout
    expect(container.querySelector('.min-h-screen')).toBeInTheDocument();
  });

  it('shows the upload button', () => {
    render(<App />);
    expect(screen.getByText('Upload Photos')).toBeInTheDocument();
  });

  it('shows view mode navigation', () => {
    render(<App />);
    expect(screen.getByText('All Photos')).toBeInTheDocument();
    expect(screen.getByText('Favorites')).toBeInTheDocument();
  });
});
