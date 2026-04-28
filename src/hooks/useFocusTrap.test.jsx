import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useFocusTrap } from './useFocusTrap';

function Trap({ isOpen }) {
  const ref = useRef(null);
  useFocusTrap(ref, isOpen);
  return (
    <div ref={ref} data-testid="container">
      <button data-testid="btn-a">A</button>
      <button data-testid="btn-b">B</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('focuses first element when opened', () => {
    render(<Trap isOpen={true} />);
    expect(document.activeElement).toBe(screen.getByTestId('btn-a'));
  });

  it('does not steal focus when closed', () => {
    const { container } = render(
      <>
        <button data-testid="outside">outside</button>
        <Trap isOpen={false} />
      </>
    );
    screen.getByTestId('outside').focus();
    expect(document.activeElement).toBe(screen.getByTestId('outside'));
  });

  it('traps Tab key to cycle within container', () => {
    render(<Trap isOpen={true} />);
    const btnA = screen.getByTestId('btn-a');
    const btnB = screen.getByTestId('btn-b');

    btnB.focus();
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    const prevented = vi.spyOn(tabEvent, 'preventDefault');
    document.dispatchEvent(tabEvent);
    expect(prevented).toHaveBeenCalled();
  });

  it('restores focus on close', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const { rerender } = render(<Trap isOpen={true} />);
    rerender(<Trap isOpen={false} />);

    expect(document.activeElement).toBe(outside);
    document.body.removeChild(outside);
  });
});
