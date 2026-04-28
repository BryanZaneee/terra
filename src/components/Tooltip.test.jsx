import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Tooltip from './Tooltip';

describe('Tooltip', () => {
  it('renders children', () => {
    render(
      <Tooltip label="hover me">
        <button>click</button>
      </Tooltip>
    );
    expect(screen.getByText('click')).toBeInTheDocument();
  });

  it('renders the label inside a tooltip role element', () => {
    render(
      <Tooltip label="more info">
        <button>click</button>
      </Tooltip>
    );
    const tip = screen.getByRole('tooltip');
    expect(tip).toBeInTheDocument();
    expect(tip).toHaveTextContent('more info');
  });

  it('skips the tooltip wrapper when label is empty', () => {
    render(
      <Tooltip label="">
        <button>click</button>
      </Tooltip>
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(screen.getByText('click')).toBeInTheDocument();
  });

  it('applies the requested position class for left placement', () => {
    render(
      <Tooltip label="left tip" position="left">
        <button>click</button>
      </Tooltip>
    );
    const tip = screen.getByRole('tooltip');
    expect(tip.className).toContain('right-full');
  });
});
