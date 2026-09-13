import {useEffect, useId, useMemo, useRef, useState} from "react";
import {createPortal} from "react-dom";

function menuBox(node, count = 6) {
  const box = node?.getBoundingClientRect?.();
  if (!box) return null;
  const rows = Math.max(1, Number(count) || 6);
  const need = rows * 44 + 12;
  const room = Math.max(160, window.innerHeight - box.bottom - 16);
  return {
    top: box.bottom + 4,
    left: box.left,
    width: box.width,
    maxHeight: Math.min(need, room),
  };
}

export default function BrandSelect({
  value,
  options = [],
  onChange,
  ariaLabel,
  searchable = false,
  placeholder = "",
}) {
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const uid = useId().replace(/:/g, "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(null);
  const selected =
    (Array.isArray(options) ? options : []).find((row) => row.id === value) ||
    (value ? { id: value, label: value } : options[0]);
  const matches = useMemo(() => {
    const rows = Array.isArray(options) ? options : [];
    const q = query.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.label, row.id, row.ticker, row.issuer]
        .filter(Boolean)
        .some((part) => String(part).toUpperCase().includes(q))
    );
  }, [options, query]);

  function openMenu() {
    setMenu(menuBox(boxRef.current, (Array.isArray(options) ? options : []).length));
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    setQuery("");
    setMenu(null);
  }

  useEffect(() => {
    function onDoc(event) {
      if (boxRef.current?.contains(event.target) || listRef.current?.contains(event.target)) return;
      closeMenu();
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onMove() {
      const next = menuBox(boxRef.current, (Array.isArray(options) ? options : []).length);
      const list = listRef.current;
      if (!next || !list) return;
      list.style.top = `${next.top}px`;
      list.style.left = `${next.left}px`;
      list.style.width = `${next.width}px`;
      list.style.maxHeight = `${next.maxHeight}px`;
    }
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, options]);

  function select(id) {
    onChange?.(id);
    closeMenu();
  }

  const list =
    open && menu
      ? createPortal(
          <ul
            ref={listRef}
            className="pair-select-list brand-select-list"
            role="listbox"
            style={{
              position: "fixed",
              top: menu.top,
              left: menu.left,
              width: menu.width,
              maxHeight: menu.maxHeight,
            }}
          >
            {matches.map((row) => (
              <li key={row.id}>
                <button type="button" className={value === row.id ? "is-active" : ""} onClick={() => select(row.id)}>
                  {row.label || row.id}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )
      : null;

  return (
    <div className={`pair-select brand-select ${open ? "is-open" : ""}`} ref={boxRef}>
      <div className="pair-select-control">
        {searchable ? (
          <input
            className="pair-select-input"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={open ? query : selected?.label || ""}
            placeholder={placeholder || selected?.label || ""}
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-haspopup="listbox"
            onFocus={openMenu}
            onChange={(event) => {
              setQuery(event.target.value);
              openMenu();
            }}
            onClick={openMenu}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeMenu();
              if (event.key === "Enter" && matches[0]) select(matches[0].id);
            }}
          />
        ) : (
          <button
            type="button"
            className="pair-select-input brand-select-value"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-haspopup="listbox"
            onClick={() => (open ? closeMenu() : openMenu())}
          >
            {selected?.label || placeholder}
          </button>
        )}
        <button
          type="button"
          className="pair-select-chevron"
          tabIndex={-1}
          aria-label={ariaLabel}
          onClick={() => (open ? closeMenu() : openMenu())}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path
              d="M4.2 7.2h11.6L10 14.2 4.2 7.2z"
              fill={`url(#${uid}-caret)`}
              stroke="#c770ff"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient id={`${uid}-caret`} x1="4" y1="7" x2="16" y2="15" gradientUnits="userSpaceOnUse">
                <stop stopColor="#00eaff" />
                <stop offset="1" stopColor="#c770ff" />
              </linearGradient>
            </defs>
          </svg>
        </button>
      </div>
      {list}
    </div>
  );
}
