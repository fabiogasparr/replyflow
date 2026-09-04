import Link from "next/link";
import { PRODUCT } from "@/lib/product";

interface BrandMarkProps {
  href?: string;
  compact?: boolean;
  tone?: "ink" | "light";
  className?: string;
}

export default function BrandMark({
  href = "/",
  compact = false,
  tone = "ink",
  className = "",
}: BrandMarkProps) {
  const foreground = tone === "light" ? "text-white" : "text-[#112620]";

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2.5 ${foreground} ${className}`}
      aria-label={`${PRODUCT.name} — página inicial`}
    >
      <span
        aria-hidden="true"
        className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[11px] bg-[#ff6b4a] text-[10px] font-black uppercase tracking-[-0.08em] text-white shadow-[inset_0_-2px_0_rgba(17,38,32,0.16)]"
      >
        <span className="relative z-10 -translate-y-px">RF</span>
        <span className="absolute -bottom-2 -right-2 h-6 w-6 rounded-full border-[5px] border-[#f5c451]" />
      </span>
      {!compact && (
        <span className="text-[17px] font-extrabold tracking-[-0.035em]">
          Reply<span className="text-[#ff6b4a]">Flow</span>
        </span>
      )}
    </Link>
  );
}
