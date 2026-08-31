"use client";

import { useEffect } from "react";
import { C, S, DIFFICULTY, R, F } from "../lib/theme";

/* THE BOTTOM SHEET.
 *
 * Every modal in the app is one of these. It rises from the bottom, covers most of the screen, and
 * scrolls internally so the page behind it never moves. That is what keeps the Home screen free of
 * vertical scroll: anything that needs more room opens in here instead of pushing the pitch down.
 *
 * Body scroll is locked while it is open, otherwise iOS scrolls the page underneath as soon as the
 * sheet's own content reaches its end.
 */
export function Sheet({ open, onClose, title, subtitle, children, maxHeight = "88vh", action = null }) {
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fade-in"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        className="sheet-up"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight,
          background: C.surface,
          borderRadius: `${R.card}px ${R.card}px 0 0`,
          border: "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "10px 0 4px", display: "flex", justifyContent: "center", flexShrink: 0 }}>
          <div style={{ width: 38, height: 4, borderRadius: 2, background: C.border }} />
        </div>

        {(title || action) && (
          <div
            style={{
              padding: "6px 16px 12px",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              borderBottom: `1px solid ${C.borderSoft}`,
              flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              {title && <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</div>}
              {subtitle && <div style={{ fontSize: 12.5, color: C.textDim, marginTop: 2 }}>{subtitle}</div>}
            </div>
            {action}
          </div>
        )}

        <div className="scroll" style={{ overflowY: "auto", flex: 1, paddingBottom: "env(safe-area-inset-bottom)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Pill({ children, colour = C.textDim, background = "transparent", border = true, size = 11 }) {
  return (
    <span
      className="num"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 6px",
        borderRadius: 6,
        fontSize: size,
        fontWeight: 600,
        color: colour,
        background,
        border: border ? `1px solid ${C.border}` : "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* A fixture, coloured by how hard it is. The colour carries the difficulty so the number does not
   have to be shown, which keeps these small enough to sit on a player card. */
export function FixtureTag({ text, difficulty = 3, size = 11 }) {
  const tone = DIFFICULTY[difficulty] || DIFFICULTY[3];
  return (
    <span
      className="num"
      style={{
        display: "inline-block",
        padding: "2px 5px",
        borderRadius: 5,
        fontSize: size,
        fontWeight: 600,
        background: tone.bg,
        color: tone.text,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

export function Chip({ active, onClick, children, colour = C.text, disabled = false }) {
  return (
    <button
      className="press"
      onClick={onClick}
      disabled={disabled}
      style={{
        /* 44px minimum. Anything smaller is a miss waiting to happen on a phone. */
        minHeight: 44,
        padding: "0 14px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: "nowrap",
        color: disabled ? C.textFaint : active ? "#000" : colour,
        background: active ? colour : C.surfaceHi,
        border: `1px solid ${active ? colour : C.border}`,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", background: C.surfaceHi, borderRadius: 10, padding: 3, gap: 2 }}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className="press"
          style={{
            flex: 1,
            minHeight: 40,
            padding: "0 6px",
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 600,
            color: value === option.value ? "#000" : C.textDim,
            background: value === option.value ? C.text : "transparent",
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, detail }) {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {detail && <div style={{ fontSize: F.body, color: C.textDim, lineHeight: 1.5 }}>{detail}</div>}
    </div>
  );
}

export function Loading({ label = "Loading" }) {
  return (
    <div style={{ padding: "72px 24px", textAlign: "center", color: C.textDim }}>
      <div
        style={{
          width: 22,
          height: 22,
          margin: "0 auto 12px",
          border: `2px solid ${C.border}`,
          borderTopColor: C.xp,
          borderRadius: "50%",
          animation: "spin 0.7s linear infinite",
        }}
      />
      <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
      <div style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}

/* Raw fetch errors say things like "Failed to fetch", which tells you nothing about what to do.
   Anything that looks like a transport failure is restated in terms of the connection. */
const friendly = (message) => {
  const text = String(message || "");
  if (/failed to fetch|networkerror|load failed|ERR_/i.test(text)) {
    return "No connection to the FPL API. Check your network and try again.";
  }
  return text || "Something went wrong.";
};

export function ErrorBox({ message, onRetry }) {
  return (
    <div style={{ padding: "48px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: C.risk }}>Could not load</div>
      <div style={{ fontSize: F.body, color: C.textDim, marginBottom: S.lg, lineHeight: 1.5 }}>{friendly(message)}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="press"
          style={{
            height: S.tap,
            padding: `0 ${S.xl}px`,
            borderRadius: 10,
            background: C.surfaceHi,
            border: `1px solid ${C.border}`,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

/* The page header used on every tab. Fixed height so switching tabs does not shift the content
   underneath, which is the sort of half-pixel jump that makes an app feel homemade. */
export function Header({ title, right = null, left = null }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "rgba(0,0,0,0.9)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: `1px solid ${C.borderSoft}`,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        minHeight: 54,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {left}
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em" }}>{title}</div>
      </div>
      {right}
    </div>
  );
}
