"use client";

import { useState, useCallback, useRef, useEffect } from "react";
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

export default function ImageGrid({ folders, folderId, initialColors, initialMonths }: Props) {
  const [colors, setColors] = useState<Record<string, string>>(initialColors);
  const [months, setMonths] = useState<Record<string, string>>(initialMonths);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [monthInput, setMonthInput] = useState("");
  const isDragging = useRef(false);
  const imageMap = useRef<Map<string, DriveImage>>(new Map());

  // 全画像のマップを構築（Drive URLアクセス用）
  useEffect(() => {
    imageMap.current.clear();
    for (const folder of folders) {
      for (const image of folder.images) {
        imageMap.current.set(image.id, image);
      }
    }
  }, [folders]);

  // ドラッグ終了をwindowで検知
  useEffect(() => {
    const onMouseUp = () => { isDragging.current = false; };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, []);

  const handleMouseDown = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleMouseEnter = useCallback((id: string) => {
    if (!isDragging.current) return;
    setSelected(prev => {
      if (prev.has(id)) return prev;
      return new Set([...prev, id]);
    });
  }, []);

  const applyColor = useCallback(async (color: string | null) => {
    if (selected.size === 0) return;
    setSaving(true);
    const ids = Array.from(selected);

    setColors(prev => {
      const next = { ...prev };
      for (const id of ids) {
        if (color === null) delete next[id];
        else next[id] = color;
      }
      return next;
    });
    setSelected(new Set());

    await Promise.all(
      ids.map(fileId =>
        fetch("/api/colors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId, fileId, color }),
        })
      )
    );
    setSaving(false);
  }, [selected, folderId]);

  const handleMonthSave = useCallback(async (color: string) => {
    const month = monthInput.trim();
    setMonths(prev => {
      const next = { ...prev };
      if (!month) delete next[color]; else next[color] = month;
      return next;
    });
    setEditingMonth(null);
    await fetch("/api/months", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, color, month: month || null }),
    });
  }, [monthInput, folderId]);

  // 全画像をパス付きでフラット化
  const allImagesWithPath = folders.flatMap(folder =>
    folder.images.map(image => ({ image, path: folder.path }))
  );

  const colorCounts = COLOR_TABS.reduce((acc, tab) => {
    acc[tab.value] = allImagesWithPath.filter(({ image }) => colors[image.id] === tab.value).length;
    return acc;
  }, {} as Record<string, number>);

  // 全てタブ：グレーを除外・黄色先頭
  const sortedFolders = folders
    .map(folder => ({
      ...folder,
      images: [...folder.images]
        .filter(img => colors[img.id] !== GRAY)
        .sort((a, b) => {
          const aY = colors[a.id] === YELLOW;
          const bY = colors[b.id] === YELLOW;
          if (aY && !bY) return -1;
          if (!aY && bY) return 1;
          return 0;
        }),
    }))
    .filter(folder => folder.images.length > 0);

  const colorTabImages = activeTab !== "all"
    ? allImagesWithPath.filter(({ image }) => colors[image.id] === activeTab)
    : [];

  const allCount = allImagesWithPath.filter(({ image }) => colors[image.id] !== GRAY).length;

  const singleSelected = selected.size === 1
    ? imageMap.current.get([...selected][0])
    : null;

  const renderImage = (image: DriveImage, path?: string) => {
    const color = colors[image.id];
    const isSelected = selected.has(image.id);
    return (
      <div
        key={image.id}
        className="relative cursor-pointer rounded overflow-hidden select-none"
        style={{
          outline: isSelected
            ? "3px solid #3b82f6"
            : color ? `4px solid ${color}` : "none",
          backgroundColor: color || "#f0f0f0",
        }}
        onMouseDown={e => handleMouseDown(image.id, e)}
        onMouseEnter={() => handleMouseEnter(image.id)}
        title={image.name}
      >
        <div className="flex items-center justify-center bg-gray-100" style={{ height: "160px" }}>
          <img
            src={image.thumbnailUrl}
            alt={image.name}
            className="max-w-full max-h-full object-contain pointer-events-none"
            loading="lazy"
            draggable={false}
          />
        </div>
        {/* 選択オーバーレイ */}
        {isSelected && (
          <div className="absolute inset-0 bg-blue-500/20 flex items-start justify-end p-1">
            <div className="bg-blue-500 rounded-full w-5 h-5 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        )}
        {path && (
          <div className="text-xs text-gray-600 px-1 py-0.5 bg-white truncate" title={path}>
            📁 {path}
          </div>
        )}
        {color && !isSelected && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5" style={{ backgroundColor: color }} />
        )}
      </div>
    );
  };

  return (
    <div>
      {saving && (
        <div className="fixed top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded text-sm z-50">
          保存中...
        </div>
      )}

      {/* タブ（スクロール追従） */}
      <div className="flex flex-wrap gap-1 mb-4 border-b sticky top-[57px] z-30 bg-white py-1 -mx-4 px-4 shadow-sm">
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
        {COLOR_TABS.map(tab => (
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
              <span className="ml-1 text-xs font-normal text-orange-500">{months[tab.value]}</span>
            )}
            （{colorCounts[tab.value]}）
          </button>
        ))}
      </div>

      {/* 全てタブ */}
      {activeTab === "all" && (
        <>
          {sortedFolders.map(folder => (
            <div key={folder.id} className="mb-8">
              <div className="bg-gray-200 font-bold px-3 py-2 rounded mb-2 text-sm text-gray-700">
                📁 {folder.path}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
                {folder.images.map(image => renderImage(image))}
              </div>
            </div>
          ))}
          {sortedFolders.length === 0 && (
            <div className="text-center text-gray-400 py-10">画像がありません</div>
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
                  onChange={e => setMonthInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleMonthSave(activeTab);
                    if (e.key === "Escape") setEditingMonth(null);
                  }}
                  placeholder="例：4月、2024年5月"
                  className="border rounded px-2 py-1 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  autoFocus
                />
                <button
                  onClick={() => handleMonthSave(activeTab)}
                  className="bg-blue-500 hover:bg-blue-600 text-white text-sm px-3 py-1 rounded"
                >
                  保存
                </button>
                <button
                  onClick={() => setEditingMonth(null)}
                  className="text-gray-400 hover:text-gray-600 text-sm px-2 py-1"
                >
                  キャンセル
                </button>
              </>
            ) : (
              <button
                onClick={() => { setEditingMonth(activeTab); setMonthInput(months[activeTab] || ""); }}
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

      {/* 選択中の固定アクションバー */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t shadow-lg px-4 py-3">
          <div className="max-w-screen-2xl mx-auto flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-700 mr-2">
              {selected.size}枚選択中
            </span>
            {COLOR_TABS.map(c => (
              <button
                key={c.value}
                onClick={() => applyColor(c.value)}
                className="flex items-center gap-1 px-3 py-1.5 rounded text-sm border-2 border-transparent hover:border-gray-400 transition-all"
                style={{ backgroundColor: c.value }}
                title={c.label}
              >
                {c.emoji} {c.label}
              </button>
            ))}
            <button
              onClick={() => applyColor(null)}
              className="px-3 py-1.5 rounded text-sm border border-gray-300 hover:border-gray-500 bg-white text-gray-600"
            >
              ⬜ 色を消す
            </button>
            {singleSelected && (
              <a
                href={singleSelected.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded text-sm text-blue-600 border border-blue-300 hover:bg-blue-50"
              >
                🔗 ドライブで開く
              </a>
            )}
            <button
              onClick={() => setSelected(new Set())}
              className="ml-auto px-4 py-1.5 rounded text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300"
            >
              ✕ 全選択解除
            </button>
          </div>
        </div>
      )}

      {/* アクションバー分の余白 */}
      {selected.size > 0 && <div className="h-20" />}
    </div>
  );
}
