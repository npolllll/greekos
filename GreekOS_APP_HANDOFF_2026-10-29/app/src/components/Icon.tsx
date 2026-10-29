/** Icon set from the approved v5.1 prototype (stroke icons, 24px grid). */
const PATHS: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>',
  school: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8m-8 4h5"/>',
  chart: '<path d="M3 3v18h18M7 17v-5m5 5V7m5 10V4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.07-1.9 1.9-.07-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21h-2.7v-.1A1.7 1.7 0 0 0 10.8 19a1.7 1.7 0 0 0-1.88.34l-.07.06-1.9-1.9.06-.07A1.7 1.7 0 0 0 7.35 15a1.7 1.7 0 0 0-1.55-1H5v-2.7h.1A1.7 1.7 0 0 0 7 10a1.7 1.7 0 0 0-.34-1.88L6.6 8l1.9-1.9.07.06A1.7 1.7 0 0 0 10.45 6 1.7 1.7 0 0 0 11.5 4.5V4h2.7v.5A1.7 1.7 0 0 0 15.75 6a1.7 1.7 0 0 0 1.88-.34l.07-.06 1.9 1.9-.06.07A1.7 1.7 0 0 0 19.2 9.5 1.7 1.7 0 0 0 20.75 10H21v2.7h-.25A1.7 1.7 0 0 0 19.4 15z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.1a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M4 12h16m-7-7 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4m8-4v4M3 10h18"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  spark: '<path d="m12 3 1.7 6.3L20 11l-6.3 1.7L12 19l-1.7-6.3L4 11l6.3-1.7z"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2.2 5.5M20 4v7h-7"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5zm-9 10 9 5 9-5m-18 5 9 5 9-5"/>',
  filter: '<path d="M4 7h16M7 12h10m-7 5h4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a16 16 0 0 1 0 20M12 2a16 16 0 0 0 0 20"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4m0 4h.01"/>',
  flag: '<path d="M4 22V4m0 0h13l-2 4 2 4H4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"/>',
};

export function Icon({ name, size, label }: { name: string; size?: number; label?: string }) {
  return (
    <svg
      className="ic"
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      style={size ? { width: size, height: size } : undefined}
      dangerouslySetInnerHTML={{ __html: PATHS[name] ?? PATHS.info }}
    />
  );
}
