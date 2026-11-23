import { useEffect, useState } from 'preact/hooks';

/** Re-renders once per animation frame (only while `active`) with the given clock's time. */
export function useNow(now: () => number, active: boolean): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    if (!active || typeof requestAnimationFrame === 'undefined') return;
    let id = 0;
    const tick = () => {
      setT(now());
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [now, active]);
  return active ? t : now();
}
