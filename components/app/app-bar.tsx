import Link from "next/link";
import { ChevronLeft, Search, Share2 } from "lucide-react";
import { BrandMark } from "@/components/ui/brand-mark";

type AppBarProps = {
  backHref?: string;
  showShare?: boolean;
};

export function AppBar({ backHref, showShare = false }: AppBarProps) {
  return (
    <header className="s-appbar">
      {backHref ? (
        <Link href={backHref} className="s-back" aria-label="Voltar">
          <ChevronLeft size={18} />
        </Link>
      ) : (
        <div className="s-appbar__brand">
          <BrandMark size={15} accent />
        </div>
      )}
      <div className="s-appbar__spacer" />
      {showShare ? (
        <button className="s-appbar__icon-btn" aria-label="Compartilhar">
          <Share2 size={16} />
        </button>
      ) : (
        <>
          <button className="s-appbar__icon-btn" aria-label="Buscar">
            <Search size={16} />
          </button>
          <span className="s-appbar__avatar">FL</span>
        </>
      )}
    </header>
  );
}
