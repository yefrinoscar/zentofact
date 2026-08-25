import { useEffect, useState } from 'react';

type VisualViewportLayout = {
  height: number;
  offsetTop: number;
};

function readVisualViewportLayout(): VisualViewportLayout {
  const viewport = window.visualViewport;
  return {
    height: viewport?.height ?? window.innerHeight,
    offsetTop: viewport?.offsetTop ?? 0,
  };
}

/** Tracks the visible viewport so full-screen overlays can stay above the mobile keyboard. */
export function useVisualViewportLayout(enabled = true) {
  const [layout, setLayout] = useState<VisualViewportLayout>(() => (
    enabled ? readVisualViewportLayout() : { height: window.innerHeight, offsetTop: 0 }
  ));

  useEffect(() => {
    if (!enabled) return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => setLayout(readVisualViewportLayout());

    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    update();

    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [enabled]);

  return layout;
}
