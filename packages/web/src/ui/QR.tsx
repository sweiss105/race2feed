import { renderSVG } from 'uqr';
import { useMemo } from 'preact/hooks';

/** A QR code as inline SVG (black on white, so it scans on any theme). */
export function QR({ value, size = '12rem', label }: { value: string; size?: string; label?: string }) {
  const svg = useMemo(() => renderSVG(value, { border: 2 }), [value]);
  return (
    <div
      data-qr={value}
      role="img"
      aria-label={label ?? `QR code for ${value}`}
      style={{ width: size, height: size, background: '#fff', borderRadius: 'var(--radius-m)', padding: '0.5rem', lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: svg.replace('<svg ', '<svg width="100%" height="100%" ') }}
    />
  );
}
