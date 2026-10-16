// Stroke icons (24×24, currentColor). Decorative: the button around each icon carries the label.
import type { ReactNode } from "react";

const icon = (paths: ReactNode) => () => <svg viewBox="0 0 24 24" aria-hidden="true">{paths}</svg>;

export const BookIcon = icon(<><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" /></>);
export const BellIcon = icon(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>);
/** Discover's tab: a compass, to explore. */
export const CompassIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>);
export const SearchIcon =icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const PlayIcon = icon(<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />);
export const PauseIcon = icon(<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor" stroke="none" />);
export const PrevIcon = icon(<path d="m15 18-6-6 6-6" />);
export const NextIcon = icon(<path d="m9 18 6-6-6-6" />);
export const BackIcon = icon(<><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>);
export const VideoIcon = icon(<><path d="m22 8-6 4 6 4V8z" /><rect x="2" y="6" width="14" height="12" rx="2" /></>);
export const ImageIcon = icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>);
export const DownloadIcon = icon(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>);
export const CopyIcon = icon(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>);
export const FlagIcon = icon(<><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>);
export const LinkIcon = icon(<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>);
export const BookmarkIcon = icon(<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />);
export const ShareIcon = icon(<><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></>);
export const CloseIcon = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const HeartIcon = icon(<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z" />);
export const AyahsIcon = icon(<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />);
export const TextIcon = icon(<path d="M4 7V4h16v3M9 20h6M12 4v16" />);
export const StyleIcon = icon(<><path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-1.5a1.5 1.5 0 0 0-1.1 2.6 1.6 1.6 0 0 1-1.1 2.8A10 10 0 0 1 12 22z" /><circle cx="7.5" cy="10.5" r="1" /><circle cx="12" cy="7.5" r="1" /><circle cx="16.5" cy="10.5" r="1" /></>);
export const CreateIcon = icon(<><rect x="5" y="2" width="14" height="20" rx="3" /><path d="M9 15h6M10 11h4" /></>);
export const UserIcon = icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
export const ResetIcon = icon(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>);
export const RefreshIcon = icon(<><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></>);
export const FeedIcon = icon(<><rect x="4" y="2" width="16" height="20" rx="3" /><path d="m10 9 5 3-5 3z" fill="currentColor" /></>);
export const SoundOnIcon = icon(<><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>);
export const SoundOffIcon = icon(<><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m22 9-6 6M16 9l6 6" /></>);
export const EditIcon = icon(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>);
/** The open book (the editor's Ayah tab). */
export const OpenBookIcon = icon(<><path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2z" /><path d="M22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z" /><path d="M6 9h2M16 9h2" /></>);
/** Reflect: two speech bubbles, many voices on the ayah (owner, 12 Oct 2026). */
export const ReflectIcon = icon(<><path d="M3 10a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3.5V18a2 2 0 0 1-2-2z" /><path d="M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3" /></>);
export const UpIcon = icon(<path d="m18 15-6-6-6 6" />);
export const DownIcon = icon(<path d="m6 9 6 6 6-6" />);
export const GlobeIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" /></>);
export const TrashIcon = icon(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></>);
export const OpenIcon = icon(<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>);
export const SignOutIcon = icon(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>);
export const PinIcon = icon(<><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>);
export const PhoneIcon = icon(<><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></>);
export const SparkIcon = icon(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />);

// The redesign (Instagram-style navigation, editor rail, streak).
export const HomeIcon = icon(<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />);
export const PlusSquareIcon = icon(<><rect x="3" y="3" width="18" height="18" rx="5.5" /><path d="M12 8v8M8 12h8" /></>);
export const ReelsIcon = icon(<><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M3 8.5h18M8 3l3 5.5M14 3l3 5.5" /><path d="M10.5 12v5l4-2.5z" fill="currentColor" /></>);
export const MenuIcon = icon(<path d="M4 7h16M4 12h16M4 17h16" />);
export const GridIcon = icon(<><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>);
export const FlameIcon = icon(<path d="M12 22a6.5 6.5 0 0 1-6.5-6.5c0-3 1.7-5.3 3.4-7 .2 1.8 1.1 3 2.4 3.3-.6-3.3.1-6.4 1.8-9.3 1.1 3.6 5.4 6.3 5.4 12.4A6.5 6.5 0 0 1 12 22z" fill="currentColor" stroke="none" />);
export const MoreIcon = icon(<><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>);
export const SendIcon = icon(<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" />);
export const WaveIcon = icon(<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />);
export const LayersIcon = icon(<><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>);
export const SparkleIcon = icon(<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" /></>);
export const CheckIcon = icon(<path d="m5 12 5 5 9-10" />);
export const UndoIcon = icon(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>);
export const RedoIcon = icon(<><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const MinusIcon = icon(<path d="M6 12h12" />);
export const MoveIcon = icon(<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />);
export const CodeIcon = icon(<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />);
export const ArrowUpIcon = icon(<><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></>);
export const ArrowUpRightIcon = icon(<path d="M7 17 17 7M8 7h9v9" />);
/** Hear the meaning (the translation voice): headphones. */
export const SlidersIcon = icon(<><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>);
