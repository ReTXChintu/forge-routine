import type { CSSProperties } from 'react';

/**
 * The icon set from design.html, ported verbatim.
 *
 * Inline SVG paths rather than an icon package: the prototype's stroke
 * weight and geometry are part of the design, and the nearest equivalent in
 * react-icons is never quite the same shape. Everything renders at
 * stroke-width 1.8 with currentColor, which is what makes icons inherit the
 * text colour of whatever they sit in.
 */
const PATHS: Record<string, string> = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1v-9"/>',
  routine:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3v4M16 3v4"/><path d="M8 13.5l1.8 1.8L12.5 12"/>',
  learn:
    '<path d="M4 5.5c2.5-1.3 5.5-1.3 8 0v13.5c-2.5-1.3-5.5-1.3-8 0Z"/><path d="M20 5.5c-2.5-1.3-5.5-1.3-8 0v13.5c2.5-1.3 5.5-1.3 8 0Z"/>',
  practice:
    '<polyline points="8 9 4 13 8 17"/><polyline points="16 9 20 13 16 17"/><line x1="13.5" y1="6" x2="10.5" y2="20"/>',
  interview:
    '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="17.5" x2="12" y2="21.5"/><line x1="8.5" y1="21.5" x2="15.5" y2="21.5"/>',
  skills:
    '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7"/><path d="M8.3 6.9 15.7 10.6"/><path d="M8.3 17.1 15.7 13.4"/>',
  tech: '<rect x="8" y="8" width="8" height="8" rx="1.5"/><rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><line x1="8" y1="1.5" x2="8" y2="3.5"/><line x1="16" y1="1.5" x2="16" y2="3.5"/><line x1="8" y1="20.5" x2="8" y2="22.5"/><line x1="16" y1="20.5" x2="16" y2="22.5"/><line x1="1.5" y1="8" x2="3.5" y2="8"/><line x1="1.5" y1="16" x2="3.5" y2="16"/><line x1="20.5" y1="8" x2="22.5" y2="8"/><line x1="20.5" y1="16" x2="22.5" y2="16"/>',
  progress:
    '<line x1="4" y1="20" x2="4" y2="12"/><line x1="10" y1="20" x2="10" y2="6"/><line x1="16" y1="20" x2="16" y2="14"/><line x1="21" y1="20" x2="21" y2="4"/>',
  settings:
    '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.9a7.6 7.6 0 0 0 0-3.8l2-1.5-2-3.5-2.4.7a7.6 7.6 0 0 0-3.3-1.9L13.2 2h-4l-.5 2.4a7.6 7.6 0 0 0-3.3 1.9l-2.4-.7-2 3.5 2 1.5a7.6 7.6 0 0 0 0 3.8l-2 1.5 2 3.5 2.4-.7a7.6 7.6 0 0 0 3.3 1.9l.5 2.3h4l.5-2.3a7.6 7.6 0 0 0 3.3-1.9l2.4.7 2-3.5Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  chevronRight: '<polyline points="9 6 15 12 9 18"/>',
  chevronLeft: '<polyline points="15 6 9 12 15 18"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  send: '<line x1="21" y1="3" x2="10" y2="14"/><polygon points="21 3 14 21 10 14 3 10 21 3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  flame:
    '<path d="M12 2.5c1 3 4.5 5 4.5 9.5a4.5 4.5 0 0 1-9 0c0-1.4.6-2.3 1.2-3.2.2 1 .9 1.7 1.6 1.7.9 0 1.4-.9 1-1.8-.6-1.5-1.3-2.7-1.3-4.7 0-.6.4-1.1 1-1.5Z"/>',
  alert:
    '<path d="M12 3 2 20h20Z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17.2" r="0.4" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9.2"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.7" r="0.4" fill="currentColor"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  star: '<polygon points="12 2.5 15 9 22 10 17 15 18.2 21.5 12 18.3 5.8 21.5 7 15 2 10 9 9 12 2.5"/>',
  code: '<polyline points="9 8 4 12.5 9 17"/><polyline points="15 8 20 12.5 15 17"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/><line x1="4.2" y1="4.2" x2="6" y2="6"/><line x1="18" y1="18" x2="19.8" y2="19.8"/><line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/><line x1="4.2" y1="19.8" x2="6" y2="18"/><line x1="18" y1="6" x2="19.8" y2="4.2"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="17.5" x2="12" y2="21.5"/>',
  arrowRight: '<line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  folder:
    '<path d="M3.5 6.5a1 1 0 0 1 1-1H9l2 2.2h8.5a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z"/>',
  filter: '<polygon points="4 4 20 4 14 12.5 14 19 10 21 10 12.5 4 4"/>',
  refresh:
    '<polyline points="17 2.5 21 6.5 17 10.5"/><path d="M3 12.5a8.5 8.5 0 0 1 15-5.5l3 -.5"/><polyline points="7 21.5 3 17.5 7 13.5"/><path d="M21 11.5a8.5 8.5 0 0 1-15 5.5l-3 .5"/>',
  help: '<circle cx="12" cy="12" r="9.2"/><path d="M9.2 9.2a2.8 2.8 0 1 1 3.9 2.6c-.9.4-1.4 1-1.4 2.1"/><circle cx="12" cy="17.3" r="0.4" fill="currentColor"/>',
  keyboard:
    '<rect x="2.5" y="6" width="19" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="10.2"/><line x1="9.5" y1="10" x2="9.5" y2="10.2"/><line x1="13" y1="10" x2="13" y2="10.2"/><line x1="16.5" y1="10" x2="16.5" y2="10.2"/><line x1="8" y1="14" x2="16" y2="14"/>',
  monitor:
    '<rect x="2.5" y="4" width="19" height="13" rx="2"/><line x1="8" y1="20.5" x2="16" y2="20.5"/><line x1="12" y1="17" x2="12" y2="20.5"/>',
  tablet:
    '<rect x="5" y="2.5" width="14" height="19" rx="2"/><line x1="12" y1="18.5" x2="12" y2="18.6"/>',
  smartphone:
    '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><line x1="12" y1="18" x2="12" y2="18.1"/>',
  zap: '<polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2"/>',
  logout:
    '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><polyline points="15 8 20 12.5 15 17"/><line x1="20" y1="12.5" x2="8.5" y2="12.5"/>',
  trend: '<polyline points="3 17 9 10.5 13.5 14 21 5"/><polyline points="15 5 21 5 21 11"/>',
  layers:
    '<polygon points="12 3 21 8 12 13 3 8 12 3"/><polyline points="3 13 12 18 21 13"/><polyline points="3 17.5 12 22.5 21 17.5"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><rect x="3" y="3" width="18" height="18" rx="2.5"/><line x1="9" y1="1" x2="9" y2="3"/><line x1="15" y1="1" x2="15" y2="3"/><line x1="9" y1="21" x2="9" y2="23"/><line x1="15" y1="21" x2="15" y2="23"/><line x1="1" y1="9" x2="3" y2="9"/><line x1="1" y1="15" x2="3" y2="15"/><line x1="21" y1="9" x2="23" y2="9"/><line x1="21" y1="15" x2="23" y2="15"/>',
  database:
    '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.66 3.58 3 8 3s8-1.34 8-3v-13"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
  git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7"/><path d="M18 15.5V11a5 5 0 0 0-5-5H8.5"/>',
  bug: '<path d="M9 8.5v-1a3 3 0 0 1 6 0v1"/><rect x="6.5" y="8.5" width="11" height="10.5" rx="5.5"/><line x1="2" y1="10.5" x2="6.5" y2="12.5"/><line x1="22" y1="10.5" x2="17.5" y2="12.5"/><line x1="2" y1="18.5" x2="6.5" y2="16"/><line x1="22" y1="18.5" x2="17.5" y2="16"/><line x1="12" y1="8.5" x2="12" y2="19"/>',
  target:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  wifi_off:
    '<line x1="2" y1="2" x2="22" y2="22"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.5a10 10 0 0 1 3.5-2.4"/><path d="M12.8 6.5A12 12 0 0 1 19 8.9"/><path d="M2.5 9a15 15 0 0 1 2.5-2"/><line x1="12" y1="20" x2="12" y2="20.1"/>',
  shield:
    '<path d="M12 2.5 20 6v6c0 5-3.4 8.4-8 9.5-4.6-1.1-8-4.5-8-9.5V6Z"/><polyline points="8.5 12 11 14.5 15.5 9.5"/>',
  eye: '<path d="M2 12.5S5.5 5.5 12 5.5 22 12.5 22 12.5 18.5 19.5 12 19.5 2 12.5 2 12.5Z"/><circle cx="12" cy="12.5" r="3"/>',
  brain:
    '<path d="M9 4.5a3 3 0 0 0-3 3v.3A3.2 3.2 0 0 0 4.5 13a3.2 3.2 0 0 0 1 5.5A3 3 0 0 0 8.5 21H9a3 3 0 0 0 3-3v-10a3 3 0 0 0-3-3Z"/><path d="M15 4.5a3 3 0 0 1 3 3v.3a3.2 3.2 0 0 1 1.5 5.2 3.2 3.2 0 0 1-1 5.5A3 3 0 0 1 15.5 21H15a3 3 0 0 1-3-3v-10a3 3 0 0 1 3-3Z"/>',
  download:
    '<path d="M12 3v13"/><polyline points="6.5 11 12 16.5 17.5 11"/><line x1="4" y1="20.5" x2="20" y2="20.5"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 13 4.6a3.6 3.6 0 0 1 5 5l-2 2"/><path d="M13 17.5 11 19.4a3.6 3.6 0 0 1-5-5l2-2"/>',
  circleSlash: '<circle cx="12" cy="12" r="9"/><line x1="5.5" y1="18.5" x2="18.5" y2="5.5"/>',
  fastForward:
    '<polygon points="4 4.5 12 12.5 4 20.5 4 4.5"/><polygon points="12 4.5 20 12.5 12 20.5 12 4.5"/>',
  volume:
    '<polygon points="3 9.5 8 9.5 13 5 13 20 8 15.5 3 15.5 3 9.5"/><path d="M17 8.5a5.5 5.5 0 0 1 0 8"/>',
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  style,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  const path = PATHS[name] ?? PATHS.help!;

  return (
    <span className="icon" style={style}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: path }}
      />
    </span>
  );
}
