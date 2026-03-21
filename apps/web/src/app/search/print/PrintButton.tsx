"use client";

export default function PrintButton() {
  return (
    <button
      className="no-print"
      style={{
        position: "fixed", top: 16, right: 16,
        fontFamily: "-apple-system, sans-serif", fontSize: 13,
        background: "#3b82f6", color: "white", border: "none",
        padding: "8px 16px", borderRadius: 6, cursor: "pointer",
      }}
      onClick={() => window.print()}
    >
      Print / Save as PDF
    </button>
  );
}
