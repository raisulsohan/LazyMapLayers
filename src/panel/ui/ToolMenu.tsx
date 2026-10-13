// A tool-row button that opens a short list of related tools (D106). The list stays in the page while
// it is closed, only hidden, so every tool keeps its data-id for the in-AE tests and the manual.

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon, type IconName } from "./icons.tsx";

export type MenuItem = {
  id: string;
  icon: IconName;
  label: string;
  title: string;
  /** Short help on the right of the row, such as the mouse shortcut. */
  hint?: string;
  disabled?: boolean;
  /** A tick: the tool is armed, its sheet is open, or the map already has it. */
  on?: boolean;
  /** A line above this row. */
  divider?: boolean;
  onClick: () => void;
};

export function ToolMenu(props: {
  id: string;
  icon: IconName;
  label: string;
  title: string;
  /** Lights the button while one of its tools is armed or its sheet is open. */
  armed?: boolean;
  items: MenuItem[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div class="tool-menu" ref={root}>
      <button
        class={`menu-button ${props.armed ? "active" : ""} ${open ? "open" : ""}`}
        data-id={props.id}
        title={props.title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={props.icon} size={15} />
        <span>{props.label}</span>
        <Icon name="chevronDown" size={10} />
      </button>
      <div class="menu" role="menu" hidden={!open}>
        {props.items.map((item) => (
          <button
            key={item.id}
            role="menuitem"
            class={`menu-item ${item.on ? "on" : ""} ${item.divider ? "divided" : ""}`}
            data-id={item.id}
            title={item.title}
            disabled={item.disabled}
            onClick={() => {
              setOpen(false);
              item.onClick();
            }}
          >
            <Icon name={item.icon} size={15} />
            <span class="menu-label">{item.label}</span>
            {item.hint && <span class="menu-hint">{item.hint}</span>}
            <span class="menu-tick">{item.on && <Icon name="check" size={12} />}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
