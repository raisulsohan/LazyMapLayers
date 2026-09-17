// LazyMapLayers' own icon set: simple 24 x 24 line drawings, written for this panel.

import type { JSX } from "preact";

const PATHS = {
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5",
  pin: "M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11zM12 12.2a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z",
  pin3d: "M12 17s-4.5-4.3-4.5-7.8a4.5 4.5 0 0 1 9 0C16.500 12.700 12 17 12 17zM4 17.5l8 3.500 8-3.500M12 10.200a1.400 1.400 0 1 0 0-2.800 1.400 1.400 0 0 0 0 2.800z",
  callout: "M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4.5V16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7.5 8.500h9M7.5 11.500h6",
  route: "M6 19a2.200 2.200 0 1 0 0-4.400A2.200 2.200 0 0 0 6 19zM18 9.400A2.200 2.200 0 1 0 18 5a2.200 2.200 0 0 0 0 4.400zM8.200 16.800h5.300a3 3 0 0 0 0-6h-3a3 3 0 0 1 0-6h5.300",
  text: "M5 19 11 5h2l6 14M7.600 14h8.800",
  borders: "M4 4h16v16H4zM4 12h3M10.500 12h3M17 12h3M12 4v3M12 10.500v3M12 17v3",
  camera: "M3 8.500A2.500 2.500 0 0 1 5.500 6h8A2.500 2.500 0 0 1 16 8.500v7a2.500 2.500 0 0 1-2.500 2.500h-8A2.500 2.500 0 0 1 3 15.500zM16 10.500l5-3v9l-5-3",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.800 2.700 4 5.700 4 9s-1.200 6.300-4 9c-2.800-2.700-4-5.700-4-9s1.200-6.300 4-9z",
  search: "M10.500 17a6.500 6.500 0 1 0 0-13 6.500 6.500 0 0 0 0 13zM20 20l-4.800-4.800",
  target: "M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 2v4M12 18v4M2 12h4M18 12h4M12 12h.01",
  key: "M12 3.500 20.500 12 12 20.500 3.500 12z",
  link: "M10 14a4 4 0 0 0 5.700 0l3.200-3.200a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3.200 3.200a4 4 0 0 0 5.700 5.700l1-1",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.500 8.500l-2 5-5 2 2-5z",
  frame: "M3 8V5a1 1 0 0 1 1-1h3M17 4h3a1 1 0 0 1 1 1v3M21 16v3a1 1 0 0 1-1 1h-3M7 20H4a1 1 0 0 1-1-1v-3",
  play: "M7 4.500v15l12-7.500z",
  stop: "M6 6h12v12H6z",
  refresh: "M20 11a8 8 0 0 0-14.300-4.500L4 8.500M4 4v4.500h4.500M4 13a8 8 0 0 0 14.300 4.500l1.700-2M20 20v-4.500h-4.500",
  trash: "M4 7h16M9 7V4.500h6V7M6.500 7l1 12.500h9l1-12.500M10 11v5.500M14 11v5.500",
  copy: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM16 9V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3",
  chevronDown: "M6 9.500l6 6 6-6",
  chevronRight: "M9.500 6l6 6-6 6",
  chevronLeft: "M14.500 6l-6 6 6 6",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  plane: "M21 4 3 11l6.500 2.500L12 20l3-5 6-11zM9.500 13.500 21 4",
  orbit: "M12 14.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5zM4.500 15.500C2 13 3.500 9 8 7.500c5-1.700 10.500-.500 12 2.500M20.500 6.500V10H17",
  cut: "M6 8.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5zM6 20.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5zM8 7.500 20 18M8 16.500 20 6",
  straight: "M4 12h16M15 7l5 5-5 5",
  x: "M6 6l12 12M18 6 6 18",
  check: "M4.500 12.500l5 5 10-11",
  download: "M12 4v11M7 10.500l5 5 5-5M5 20h14",
  image: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M15.500 9.500h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  warning: "M12 4 2.500 20h19zM12 10v4.500M12 17.500h.01",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4",
  highlight: "M5 9 10 4l6.500 1.500L20 11l-2.500 7-6.500 2-6-4.500zM9.500 11.500l2 2 3.500-4",
  palette: "M12 3a9 9 0 1 0 0 18c1.400 0 2.200-.900 2.200-2 0-1.700 1.200-2.500 2.800-2.500H18.500A2.500 2.500 0 0 0 21 14c0-6-4-11-9-11zM7.500 13h.01M8.500 8.500h.01M13 6.500h.01M17 10h.01"
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; size?: number; filled?: boolean; class?: string }): JSX.Element {
  const size = props.size ?? 16;
  return (
    <svg
      class={`icon ${props.class ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={props.filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}

/** A square icon button with a tooltip (and the same text for screen readers). */
export function IconButton(props: {
  icon: IconName;
  title: string;
  onClick?: (event: MouseEvent) => void;
  disabled?: boolean;
  active?: boolean;
  id?: string;
  size?: number;
  filled?: boolean;
  class?: string;
}): JSX.Element {
  return (
    <button
      class={`icon-button ${props.active ? "active" : ""} ${props.class ?? ""}`}
      title={props.title}
      aria-label={props.title}
      data-id={props.id}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={props.size} filled={props.filled} />
    </button>
  );
}
