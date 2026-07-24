// Reports how many pixels at the bottom of the window are currently covered by the
// on-screen keyboard (including its native accessory / AutoFill bar).
//
// Why this exists: on iOS the keyboard — and the AutoFill/QuickType bar attached to
// it — is NATIVE UI drawn on top of the page. You can't hide it or beat it with
// z-index. The only way to keep our symbol toolbar visible is to position it in the
// area that ISN'T covered. window.visualViewport tells us exactly that: when the
// keyboard is up, the visual viewport shrinks to the still-visible region, so
// (window height − visual viewport height − its top offset) = the covered height.

import { useEffect, useState } from 'react';

export function useVisualViewportInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined; // very old browsers: fall back to inset 0

    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(covered)));
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
