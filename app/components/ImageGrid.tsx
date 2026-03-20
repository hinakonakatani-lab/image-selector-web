"use client";

import { useState, useCallback } from "react";
import ColorPicker from "./ColorPicker";
import type { DriveFolder, DriveImage } from "@/app/api/drive/route";

const YELLOW = "#ffe599";
const GRAY = "#999999";

const COLOR_TABS = [
  { value: "#ea9999", label: "赤", emoji: "🟥" },
  { value: "#b6d7a8", label: "緑", emoji: "🟩" },
  { value: "#a4c2f4", label: "青", emoji: "🟦" },
  { value: "#b4a7d6", label: "紫", emoji: "🟪" },
  { value: "#ffe599", label: "黄（候補）", emoji: "🟨" },
  { value: "#999999", label: "グレー（NG）", emoji: "⬛" },
];

type Props = {
  folders: DriveFolder[];
  folderId: string;
  initialColors: Record<string, string>;
  initialMonths: Record<string, string>;
};

type Popup = {
  image: DriveImage;
  x: number;
  y: number;
} | null;

export default function ImageGrid({ folders, folderId, initialColors, initialMonths }: Props) {
  const [colors, setColors] = useState<Record<string, string>>(initialColors);
  const [months, setMonths] = useState<Record<string, string>>(initialMonths);
  const [popup, setPopup] = useState<Popup>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [monthInput, setMonthInput] = useState("");

  const handleImageClick = useCallback(
    (image: DriveImage, e: React.MouseEvent) => {
      e.stopPropagation();
      if (popup?.image.id === image.id) {
        setPopup(null);
        return;
      }
      const x = Math.min(e.clientX, window.innerWidth - 260);
      const y = Math.min(e.clientY + 10, window.innerHeight - 280);
      setPopup({ image, x, y });
    },
    [popup]
  );

  const handleColorSelect = useCallback(
    async (color: string | null) => {
      if (!popup) return;
      const fileId = popup.image.id;
      setSaving(true);

      setColors((prev) => {
        const next = { ...prev };
        if (color === null) {
          delete next[fileId];
        } else {
          next[fileId] = color;
        }
        return next;
      });
      setPopup(null);

      await fetch("/api/colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, fileId, color }),
      });
      setSaving(false);
    },
    [popup, folderId]
  );

  const handleMonthSave = useCallback(
    async (color: string) => {
      const month = monthInput.trim();
      setMonths((prev) => {
        const next = { ...prev };
        if (!month) {
          delete next[color];
        } else {
          next[color] = month;
        }
        return next;
      });
      setEditingMonth(null);
      await fetch("/api/months", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, color, month: month || null }),
      });
    },
    [monthInput, folderId]
  );

  // 全画像をパス付きでフラット化
  const allImagesWithPath = folders.flatMap((folder) =>
    folder.images.map((image) => ({ image, path: folder.path }))
  );

  // 各色タブの枚数
  const colorCounts = COLOR_TABS.reduce((acc, tab) => {
    acc[tab.value] = allImagesWithPath.filter(
      ({ image }) => colors[image.id] === tab.value
    ).length;
    return acc;
  }, {} as Record<string, number>);

  // 「全て」タブ：グレーを除外し、黄色を先頭に
  const sortedFolders = folders
    .map((folder) => ({
      ...folder,
      images: [...folder.images]
        .filter((img) => colors[img.id] !== GRAY)
        .sort((a, b) => {
          const aY = colors[a.id] === YELLOW;
          const bY = colors[b.id] === YELLOW;
          if (aY && !bY) return -1;
          if (!aY && bY) return 1;
          return 0;
        }),
    }))
    .filter((folder) => folder.images.length > 0);

  // 色タブ：対象色の画像をパス付きで表示
  const colorTabImages =
    activeTab !== "all"
      ? allImagesWithPath.filter(({ image }) => colors[image.id] === activeTab)
      : [];

  const allCount = allImagesWithPath.filter(
    ({ image }) => colors[image.id] !== GRAY
  ).length;

  const renderImage = (image: DriveImage, path?: string) => {
    const color = colors[image.id];
    return (
      <div
        key={image.id}
        className="relative cursor-pointer rounded overflow-hidden"
        style={{
          outline: color ? `4px solid ${color}` : "none",
          backgroundColor: color || "#f0f0f0",
        }}
        onClick={(e) => handleImageClick(image, e)}
        title={image.name}
      >
        <div className="aspect-square">
          <img
            src={image.thumbnailUrl}
            alt={image.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
        {path && (
          <div
            className="text-xs text-gray-600 px-1 py-0.5 bg-white truncate"
            title={path}
          >
            📁 {path}
          </div>
        )}
        {color && (
          <div
            className="absolute bottom-0 left-0 right-0 h-1.5"
            style={{ backgroundColor: color }}
          />
        )}
      </div>
    );
  };

  return (
    <div onClick={() => setPopup(null)}>
      {saving && (
        <div className="fixed top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded text-sm z-50">
          保存中...
        </div>
      )}

      {popup && (
        <div
          className="fixed z-50"
          style={{ left: popup.x, top: popup.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white rounded shadow-lg border overflow-hidden">
            <a
              href={popup.image.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 border-b"
            >
              🔗 Googleドライブで開く
            </a>
            <ColorPicker
              currentColor={colors[popup.image.id] ?? null}
              onSelect={handleColorSelect}
            />
          </div>
        </div>
      )}

      {/* タブ */}
      <div className="flex flex-wrap gap-1 mb-4 border-b">
        <button
          onClick={() => setActiveTab("all")}
          className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "all"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          全て（{allCount}）
        </button>
        {COLOR_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.value
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.emoji} {tab.label}
            {months[tab.value] && (
              <span className="ml-1 text-xs font-normal text-orange-500">
                {months[tab.value]}
              </span>
            )}
            （{colorCounts[tab.value]}）
          </button>
        ))}
      </div>

      {/* 全てタブ */}
      {activeTab === "all" && (
        <>
          {sortedFolders.map((folder) => (
            <div key={folder.id} className="mb-8">
              <div className="bg-gray-200 font-bold px-3 py-2 rounded mb-2 text-sm text-gray-700">
                📁 {folder.path}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
                {folder.images.map((image) => renderImage(image))}
              </div>
            </div>
          ))}
          {sortedFolders.length === 0 && (
            <div className="text-center text-gray-400 py-10">
              画像がありません
            </div>
          )}
        </>
      )}

      {/* 色別タブ */}
      {activeTab !== "all" && (
        <>
          {/* 月設定 */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-gray-500">使用月：</span>
            {editingMonth === activeTab ? (
              <>
                <input
                  type="text"
                  value={monthInput}
                  onChange={(e) => setMonthInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleMonthSave(activeTab);
                    if (e.key === "Escape") setEditingMonth(null);
                  }}
                  placeholder="例：4月、2024年5月"
                  className="border rounded px-2 py-1 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); handleMonthSave(activeTab); }}
                  className="bg-blue-500 hover:bg-blue-600 text-white text-sm px-3 py-1 rounded"
                >
                  保存
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingMonth(null); }}
                  className="text-gray-400 hover:text-gray-600 text-sm px-2 py-1"
                >
                  キャンセル
                </button>
              </>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingMonth(activeTab);
                  setMonthInput(months[activeTab] || "");
                }}
                className="text-sm px-3 py-1 rounded border border-dashed border-gray-300 hover:border-gray-400 text-gray-600"
              >
                {months[activeTab] ? `${months[activeTab]} ✏️` : "＋ 月を設定"}
              </button>
            )}
          </div>

          {colorTabImages.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {colorTabImages.map(({ image, path }) => renderImage(image, path))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-10">
              この色がついた画像はまだありません
            </div>
          )}
        </>
      )}
    </div>
  );
}
