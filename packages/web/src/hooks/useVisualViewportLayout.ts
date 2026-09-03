import { useEffect } from 'react';

const CSS_VAR = '--picker-vvh';

/** Keeps a CSS viewport height variable in sync with the mobile keyboard without React re-renders. */
export function useVisualViewportCssVar(enabled = true) {
  useEffect(() => {
    if (!enabled) {
      document.documentElement.style.removeProperty(CSS_VAR);
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) return;

    let frame = 0;
    let lastHeight = 0;

    const apply = () => {
      frame = 0;
      const height = Math.round(viewport.height);
      if (height === lastHeight) return;
      lastHeight = height;
      document.documentElement.style.setProperty(CSS_VAR, `${height}px`);
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    viewport.addEventListener('resize', schedule);
    apply();

    return () => {
      viewport.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
      document.documentElement.style.removeProperty(CSS_VAR);
    };
  }, [enabled]);
}

export { CSS_VAR as PICKER_VIEWPORT_HEIGHT_VAR };
