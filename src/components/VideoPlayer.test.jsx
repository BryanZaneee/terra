import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VideoPlayer from './VideoPlayer';

describe('VideoPlayer', () => {
  it('renders video element with src', () => {
    const { container } = render(
      <VideoPlayer src="asset://localhost/video.mp4" />
    );
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video.src).toContain('video.mp4');
  });

  it('auto-plays by default', () => {
    render(<VideoPlayer src="asset://localhost/video.mp4" />);
    expect(HTMLVideoElement.prototype.play).toHaveBeenCalled();
  });

  it('does not auto-play when autoPlay is false', () => {
    HTMLVideoElement.prototype.play.mockClear();
    render(<VideoPlayer src="asset://localhost/video.mp4" autoPlay={false} />);
    expect(HTMLVideoElement.prototype.play).not.toHaveBeenCalled();
  });

  it('renders seek slider', () => {
    const { container } = render(
      <VideoPlayer src="asset://localhost/video.mp4" />
    );
    expect(container.querySelector('input[type="range"]')).toBeInTheDocument();
  });

  it('renders CC button', () => {
    render(<VideoPlayer src="asset://localhost/video.mp4" />);
    expect(screen.getByText('CC')).toBeInTheDocument();
  });
});
