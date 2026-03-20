"use client";

import { useRef, useState } from "react";

const COLORS = [
  { value: "#ea9999", label: "赤" },
  { value: "#b6d7a8", label: "緑" },
  { value: "#a4c2f4", label: "青" },
  { value: "#b4a7d6", label: "紫" },
  { value: "#ffe599", label: "黄" },
  { value: "#999999", label: "グレー" },
];

type Props = { folderId: string };

export default function ManualColorPicker({ folderId }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [selectedColor, setSelectedColor] = useState(COLORS[0].value);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async () => {
    if (!url.trim() || !folderId) return;
    setLoading(true);
    setStatus("");
    const res = await fetch("/api/manual-color", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl: url.trim(), color: selectedColor, folderId }),
    });
    const result = await res.json();
    setLoading(false);
    if (res.ok) {
      // ImageGridに色の変化を即時反映させるカスタムイベントを発火
      window.dispatchEvent(
        new CustomEvent("manualColorApplied", {
          detail: { fileId: result.fileId, color: result.color },
        })
      );
      setStatus("✅ 色を設定しました");
      setUrl("");
      setTimeout(() => setStatus(""), 3000);
    } else {
      setStatus(`❌ ${result.error}`);
    }
  };

  if (!folderId) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600 transition-colors"
        title="URL指定で手動着色"
      >
        🎨
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-8 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-80"
        >
          <p className="text-xs text-gray-500 mb-2 font-medium">URL指定で手動着色</p>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="GoogleドライブのファイルURL"
            className="w-full border rounded px-2 py-1 text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="flex gap-1 mb-2">
            {COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => setSelectedColor(c.value)}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c.value,
                  borderColor: selectedColor === c.value ? "#333" : "transparent",
                }}
                title={c.label}
              />
            ))}
          </div>
          <button
            onClick={handleSubmit}
            disabled={loading || !url.trim()}
            className="w-full text-xs py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            {loading ? "保存中..." : "色を設定"}
          </button>
          {status && <p className="text-xs mt-1 text-gray-600">{status}</p>}
        </div>
      )}
    </div>
  );
}
