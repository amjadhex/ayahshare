// The AyahShare lockup (brand/README.md): emerald "Ayah" on light, gold on dark. Both files are in the page; the
// colour scheme (the system's, or data-theme) shows one of them.
import "./brand-logo.css";

export function BrandLogo({ name }: { name: string }) {
  return (
    <span className="home-logo" role="img" aria-label={name}>
      <img className="home-logo-light" src="/brand/lockup-light.svg" alt="" width="122" height="29" decoding="async" />
      <img className="home-logo-dark" src="/brand/lockup-dark.svg" alt="" width="122" height="29" decoding="async" />
    </span>
  );
}

/** The mark alone (emerald on light, gold on dark). */
export function BrandMark({ size = 52 }: { size?: number }) {
  return (
    <span className="home-mark" aria-hidden="true">
      <img className="home-logo-light" src="/brand/mark-emerald.svg" alt="" width={size} height={size} decoding="async" />
      <img className="home-logo-dark" src="/brand/mark.svg" alt="" width={size} height={size} decoding="async" />
    </span>
  );
}
