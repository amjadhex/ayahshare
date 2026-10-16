// The maker's credit (owner, 8 Oct 2026): "</> Made by Amjad Ali with Datahex", quietly at the foot of Home, Discover,
// Profile and Settings, and of the side bar on computers (where the screens leave it out). Only in the app: the images
// and videos carry the brand watermark alone. The name is plain text (owner, 12 Oct 2026: no link); Datahex links out:
// a new tab on the web, the system browser in the app.
import type { MouseEvent } from "react";
import { platform } from "../platform";
import { t } from "../strings";
import { CodeIcon } from "./icons";

const STUDIO_URL = "https://datahex.co/";

function External({ href, children }: { href: string; children: string }) {
  const open = (e: MouseEvent) => { e.preventDefault(); platform.openExternal(href); };
  return <a href={href} target="_blank" rel="noopener" onClick={open}>{children}</a>;
}

export function MadeBy({ className = "" }: { className?: string }) {
  return (
    <p className={`made-by ${className}`.trim()}>
      <CodeIcon />{t.madeBy} {t.makerName} {t.madeWith} <External href={STUDIO_URL}>{t.studioName}</External>
    </p>
  );
}
