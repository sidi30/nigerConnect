import { IconHeart, IconComment, IconShare } from "./Icons";

type Post = {
  name: string;
  role: string;
  city: string;
  flag: string;
  badge?: { label: string; color: string };
  content: string;
  likes: number;
  comments: number;
  timeAgo: string;
};

const posts: Post[] = [
  {
    name: "Aïcha M.",
    role: "Entrepreneure • Mode",
    city: "Paris",
    flag: "🇫🇷",
    badge: { label: "Business", color: "bg-amber-100 text-amber-800" },
    content:
      "Nouvelle collection wax authentique du Niger disponible ✨ Livraison partout en Europe.",
    likes: 42,
    comments: 8,
    timeAgo: "2 h",
  },
  {
    name: "Ibrahim S.",
    role: "Ingénieur IT",
    city: "Montréal",
    flag: "🇨🇦",
    badge: { label: "Entraide", color: "bg-brand-greenSoft text-brand-greenDark" },
    content:
      "Je cherche à héberger un étudiant nigérien arrivant à McGill en septembre. DM 🙏",
    likes: 127,
    comments: 23,
    timeAgo: "5 h",
  },
];

export function PhoneMockup({ className = "" }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {/* Phone frame */}
      <div className="relative mx-auto h-[620px] w-[300px] rounded-[44px] bg-brand-brown p-3 shadow-[0_30px_80px_-20px_rgba(26,15,10,0.45)]">
        <div className="absolute left-1/2 top-3 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-brand-brown" />
        <div className="relative h-full w-full overflow-hidden rounded-[34px] bg-brand-cream">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-tan-200 bg-white/70 px-4 pb-3 pt-8 backdrop-blur">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-tan-500">
                Bonjour
              </p>
              <p className="font-serif text-lg font-bold text-brand-brown">Fatima 👋</p>
            </div>
            <div className="h-9 w-9 rounded-full bg-gradient-orange ring-2 ring-white" />
          </div>

          {/* Stories row */}
          <div className="flex gap-3 overflow-hidden px-4 py-3">
            {["🇳🇪", "🇫🇷", "🇨🇦", "🇺🇸", "🇸🇳"].map((f, i) => (
              <div key={i} className="shrink-0 text-center">
                <div className="relative">
                  <div className="h-14 w-14 rounded-full bg-gradient-to-tr from-brand-orange via-brand-orangeBright to-brand-green p-[2px]">
                    <div className="flex h-full w-full items-center justify-center rounded-full bg-brand-cream text-xl">
                      {f}
                    </div>
                  </div>
                </div>
                <p className="mt-1 text-[9px] text-tan-600">Story</p>
              </div>
            ))}
          </div>

          {/* Posts */}
          <div className="space-y-3 px-3 pb-20">
            {posts.map((p, i) => (
              <div key={i} className="rounded-2xl bg-white p-3 shadow-soft">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-tan-200 to-peach-100" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-brand-brown">{p.name}</p>
                    <p className="text-[10px] text-tan-500">
                      {p.role} • {p.flag} {p.city} • {p.timeAgo}
                    </p>
                  </div>
                  {p.badge && (
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${p.badge.color}`}>
                      {p.badge.label}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-brand-brown">{p.content}</p>
                <div className="mt-2.5 flex items-center gap-4 border-t border-tan-100 pt-2 text-[10px] text-tan-600">
                  <span className="inline-flex items-center gap-1">
                    <IconHeart className="h-3.5 w-3.5 text-brand-orange" /> {p.likes}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <IconComment className="h-3.5 w-3.5" /> {p.comments}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <IconShare className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom tab bar */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-around border-t border-tan-200 bg-white/95 py-2.5 backdrop-blur">
            {["🏠", "🗺️", "💬", "🛍️", "👤"].map((e, i) => (
              <div
                key={i}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                  i === 0 ? "bg-gradient-orange shadow-orange" : ""
                }`}
              >
                {e}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating badges */}
      <div className="absolute -left-4 top-20 hidden animate-float-slow rounded-2xl bg-white px-4 py-3 shadow-card md:block">
        <p className="text-[10px] font-medium uppercase tracking-wider text-tan-500">
          En ligne maintenant
        </p>
        <p className="mt-1 font-serif text-xl font-bold text-brand-brown">
          1 240 <span className="text-brand-green">•</span>
        </p>
      </div>
      <div
        className="absolute -right-6 bottom-24 hidden animate-float-slow rounded-2xl bg-gradient-orange px-4 py-3 text-white shadow-orangeLg md:block"
        style={{ animationDelay: "1.5s" }}
      >
        <p className="text-[10px] font-medium uppercase tracking-wider opacity-80">
          Nouveau message
        </p>
        <p className="mt-0.5 text-sm font-semibold">Ibrahim t'a écrit 💬</p>
      </div>
    </div>
  );
}
