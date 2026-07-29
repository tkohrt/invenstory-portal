"use client";
export default function Drawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer">
        <button className="x" onClick={onClose} aria-label="Close">×</button>
        {children}
      </div>
    </div>
  );
}
