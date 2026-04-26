export function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E05206" />
          <stop offset="100%" stopColor="#FF6D00" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#lg)" />
      <path
        d="M15 34V14h4l10 13.5V14h4v20h-4L19 20.5V34h-4Z"
        fill="white"
      />
      <circle cx="36" cy="14" r="3" fill="#0DB02B" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <Logo className="h-9 w-9" />
      <span className="font-serif text-xl font-bold tracking-tight text-brand-brown">
        NigerConnect
      </span>
    </div>
  );
}
