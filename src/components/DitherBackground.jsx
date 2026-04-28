import { useRef, useEffect } from 'react';
import { CONFIG } from '../config';
import { useTheme } from '../contexts/ThemeContext';

const THEME_COLORS = {
  dark: { bg: '#050505', fg: '#2a2a2a' },
  light: { bg: '#f1ede4', fg: '#c8c2b4' },
};

const DitherBackground = () => {
  const canvasRef = useRef(null);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    let animationFrameId;
    let isVisible = true;
    let lastFrameTime = 0;
    const frameInterval = 1000 / CONFIG.ANIMATION_FPS;
    const chars = " .:-=+*#%@";

    const charWidth = 20;
    const charHeight = 24;
    const fontSize = 20;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    const handleVisibilityChange = () => {
      isVisible = !document.hidden;
      if (isVisible && !animationFrameId) {
        lastFrameTime = performance.now();
        animationFrameId = requestAnimationFrame(render);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const bubbles = [];
    const bubbleCount = Math.floor(Math.random() * 3) + 4;

    for (let i = 0; i < bubbleCount; i++) {
      bubbles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: Math.random() * 100 + 50,
        speed: 0.002
      });
    }

    const render = (currentTime) => {
      if (!isVisible) {
        animationFrameId = null;
        return;
      }

      const elapsed = currentTime - lastFrameTime;
      if (elapsed < frameInterval) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }
      lastFrameTime = currentTime - (elapsed % frameInterval);

      const palette = THEME_COLORS[themeRef.current] || THEME_COLORS.dark;
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = palette.fg;
      ctx.font = `${fontSize}px monospace`;

      const cols = Math.ceil(canvas.width / charWidth);
      const rows = Math.ceil(canvas.height / charHeight);

      bubbles.forEach(bubble => {
        bubble.y -= bubble.speed * 100;
        if (bubble.y + bubble.radius < 0) {
          bubble.y = canvas.height + bubble.radius;
          bubble.x = Math.random() * canvas.width;
        }
      });

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const pixelX = x * charWidth;
          const pixelY = y * charHeight;

          let closestDist = Infinity;

          for (let i = 0; i < bubbles.length; i++) {
            const bubble = bubbles[i];
            const dx = pixelX - bubble.x;
            const dy = pixelY - bubble.y;

            if (Math.abs(dx) > bubble.radius && Math.abs(dy) > bubble.radius) continue;

            const dist = Math.sqrt(dx * dx + dy * dy);
            const normalizedDist = dist / bubble.radius;

            if (normalizedDist < closestDist) {
              closestDist = normalizedDist;
            }
          }

          if (closestDist < 1.0) {
            const intensity = 1.0 - closestDist;
            const charIndex = Math.floor(intensity * (chars.length - 1));
            ctx.fillText(chars[charIndex], pixelX, pixelY);
          }
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };
    animationFrameId = requestAnimationFrame(render);

    return () => {
      isVisible = false;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }

      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (canvas && ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
      }

      bubbles.length = 0;
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed top-0 left-0 w-full h-full -z-10 pointer-events-none" />;
};

export default DitherBackground;
