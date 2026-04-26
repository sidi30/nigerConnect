import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function IconMap(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}

export function IconFeed(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </svg>
  );
}

export function IconChat(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 12a8 8 0 0 1-11.6 7.2L4 20l1-4.2A8 8 0 1 1 21 12Z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
    </svg>
  );
}

export function IconHandshake(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="m11 17 2 2a1.5 1.5 0 0 0 2.1 0l3.4-3.4a2 2 0 0 0 0-2.8L14 8.3" />
      <path d="m6 13 3.4 3.4a1.5 1.5 0 0 0 2.1 0l.5-.5" />
      <path d="M3 11.5 6.5 8a2 2 0 0 1 2.8 0L12 10.7" />
      <path d="m13 8 2-2 3 1 3-3" />
      <path d="M3 11.5 1 13" />
    </svg>
  );
}

export function IconUsers(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="17" cy="10" r="2.6" />
      <path d="M16 14.2a5 5 0 0 1 5.5 4.8" />
    </svg>
  );
}

export function IconBell(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7Z" />
      <path d="M10.5 20a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

export function IconShield(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function IconSparkle(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
    </svg>
  );
}

export function IconApple(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M16.37 12.64c-.02-2.38 1.94-3.52 2.03-3.57-1.11-1.62-2.83-1.84-3.44-1.87-1.46-.15-2.85.86-3.59.86-.74 0-1.88-.84-3.1-.82-1.59.02-3.06.93-3.88 2.36-1.66 2.87-.42 7.12 1.2 9.45.79 1.15 1.73 2.43 2.96 2.39 1.19-.05 1.64-.77 3.08-.77 1.43 0 1.84.77 3.1.74 1.28-.02 2.09-1.16 2.87-2.32.9-1.33 1.28-2.62 1.3-2.69-.03-.01-2.49-.96-2.52-3.76Zm-2.37-6.89c.65-.79 1.08-1.88.97-2.97-.94.04-2.07.63-2.74 1.41-.6.69-1.12 1.8-.98 2.86 1.04.08 2.1-.53 2.75-1.3Z" />
    </svg>
  );
}

export function IconGooglePlay(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M3.6 2.4c-.24.25-.39.64-.39 1.14v17c0 .5.15.89.4 1.14l.07.07L13.3 12v-.1L3.67 2.33l-.07.07Z" opacity=".8" />
      <path d="M16.8 15.27 13.3 12v-.1l3.5-3.27.08.05 4.14 2.35c1.18.67 1.18 1.76 0 2.43l-4.14 2.35-.08.06Z" />
      <path d="M16.88 15.33 13.3 11.95 3.6 21.68c.39.41 1.03.46 1.76.06l11.52-6.41" opacity=".9" />
      <path d="M16.88 8.62 5.36 2.22c-.73-.41-1.37-.36-1.76.05L13.3 11.95l3.58-3.33Z" opacity=".7" />
    </svg>
  );
}

export function IconArrowRight(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

export function IconHeart(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" />
    </svg>
  );
}

export function IconComment(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 12a8 8 0 0 1-12 7l-5 1 1.5-4.2A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

export function IconShare(p: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="m8 11 8-4M8 13l8 4" />
    </svg>
  );
}
