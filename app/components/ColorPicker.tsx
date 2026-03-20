"use client";

const COLORS = [
  { label: "赤", value: "#ea9999", emoji: "🟥" },
  { label: "緑", value: "#b6d7a8", emoji: "🟩" },
  { label: "青", value: "#a4c2f4", emoji: "🟦" },
  { label: "紫", value: "#b4a7d6", emoji: "🟪" },
  { label: "黄（候補）", value: "#ffe599", emoji: "🟨" },
  { label: "グレー（NG）", value: "#999999", emoji: "⬛" },
];

type Props = {
  currentColor: string | null;
  onSelect: (color: string | null) => void;
};

export default function ColorPicker({ currentColor, onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-2 p-2 bg-white rounded shadow-lg border">
      {COLORS.map((c) => (
        <button
          key={c.value}
          onClick={() => onSelect(c.value)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-sm border-2 transition-all ${
            currentColor === c.value
              ? "border-gray-800 scale-110"
              : "border-transparent hover:border-gray-400"
          }`}
          style={{ backgroundColor: c.value }}
          title={c.label}
        >
          {c.emoji} {c.label}
        </button>
      ))}
      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-1 px-2 py-1 rounded text-sm border-2 transition-all bg-white ${
          currentColor === null
            ? "border-gray-800"
            : "border-gray-300 hover:border-gray-500"
        }`}
      >
        ⬜ 色を消す
      </button>
    </div>
  );
}
