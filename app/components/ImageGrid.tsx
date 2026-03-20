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
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importStatus, setImportStatus] = useState("");
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

  const handleImport = useCallback(async () => {
    const importColors: Record<string, string> = {};
    const lines = importText.trim().split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const fileId = parts[0];
        const color = parts[parts.length - 1];
        if (fileId && color.startsWith("#")) {
          importColors[fileId] = color;
        }
      }
    }
    const count = Object.keys(importColors).length;
    if (count === 0) {
      setImportStatus("読み込めるデータがありませんでした。形式を確認してください。");
      return;
    }
    setImportStatus("インポート中...");
    const res = await fetch("/api/colors", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, importColors }),
    });
    if (res.ok) {
      setColors(prev => ({ ...prev, ...importColors }));
      setImportStatus(`✅ ${count}件インポートしました`);
      setImportText("");
      setTimeout(() => { setShowImport(false); setImportStatus(""); }, 1500);
    } else {
      setImportStatus("❌ インポートに失敗しました");
    }
  }, [importText, folderId]);

  // 全画像をパス付きでフラット化（handleClearColorTabで使うため先に宣言）
  const allImagesWithPath = folders.flatMap(folder =>
    folder.images.map(image => ({ image, path: folder.path }))
  );

  const handleClearColorTab = useCallback(async (color: string) => {
    const tab = COLOR_TABS.find(t => t.value === color);
    const count = allImagesWithPath.filter(({ image }) => colors[image.id] === color).length;
    if (!window.confirm(`${tab?.emoji}${tab?.label} の画像 ${count}枚 の色を全て消します。\nよろしいですか？`)) return;

    const ids = allImagesWithPath
      .filter(({ image }) => colors[image.id] === color)
      .map(({ image }) => image.id);

    setSaving(true);
    setColors(prev => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
    await Promise.all(
      ids.map(fileId =>
        fetch("/api/colors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId, fileId, color: null }),
        })
      )
    );
    setSaving(false);
  }, [allImagesWithPath, colors, folderId]);

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
            onError={e => {
              const el = e.currentTarget;
              el.style.display = "none";
              const parent = el.parentElement;
              if (parent && !parent.querySelector(".thumb-error")) {
                const div = document.createElement("div");
                div.className = "thumb-error flex flex-col items-center justify-center text-gray-400 text-xs p-2 text-center";
                div.innerHTML = `<span class="text-2xl mb-1">🔄</span><span>再読み込みで表示</span>`;
                parent.appendChild(div);
              }
            }}
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

  const SIDEBAR_W = 112; // px

  return (
    <div style={{ marginLeft: selected.size > 0 ? SIDEBAR_W : 0, transition: "margin-left 0.3s ease" }}>
      {saving && (
        <div className="fixed top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded text-sm z-50">
          保存中...
        </div>
      )}

      {/* インポートボタン */}
      <div className="flex justify-end mb-2">
        <button
          onClick={() => { setShowImport(v => !v); setImportStatus(""); }}
          className="text-sm px-3 py-1 rounded border border-gray-300 hover:border-gray-400 text-gray-600"
        >
          📥 色データをインポート
        </button>
      </div>

      {/* インポートパネル */}
      {showImport && (
        <div className="mb-4 p-4 bg-gray-50 border rounded-lg">
          <p className="text-sm text-gray-600 mb-2 font-medium">スプレッドシートの色データを貼り付けてください：</p>
          <p className="text-xs text-gray-400 mb-2">形式：ファイルID（スペース）#カラーコード　を1行ずつ</p>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder={"1ADLOYQQid9SwlI...    #a4c2f4\n1WiQaPmGXJ9TEq...    #ea9999"}
            className="w-full h-40 border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleImport}
              className="bg-blue-500 hover:bg-blue-600 text-white text-sm px-4 py-1.5 rounded"
            >
              インポート実行
            </button>
            <button
              onClick={() => { setShowImport(false); setImportText(""); setImportStatus(""); }}
              className="text-gray-400 hover:text-gray-600 text-sm px-3 py-1.5"
            >
              キャンセル
            </button>
            {importStatus && <span className="text-sm text-gray-600">{importStatus}</span>}
          </div>
        </div>
      )}

      {/* タブ（スクロール追従） */}
      <div className="flex flex-wrap gap-1 mb-4 border-b sticky top-[57px] z-20 bg-white py-1 -mx-4 px-4 shadow-sm">
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
          {/* 月設定 + 一括削除 */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
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
            {colorTabImages.length > 0 && (
              <button
                onClick={() => handleClearColorTab(activeTab)}
                className="ml-2 text-sm px-3 py-1 rounded border border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400 transition-colors"
              >
                🗑️ この色を全て消す
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

      {/* 選択中の左サイドバー */}
      <div
        className="fixed left-0 top-[57px] bottom-0 z-30 bg-white border-r border-gray-200 shadow-md flex flex-col gap-1 py-3 px-2 overflow-y-auto"
        style={{
          width: SIDEBAR_W,
          transform: selected.size > 0 ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s ease",
        }}
      >
        <div className="text-xs font-bold text-gray-400 text-center mb-2 pb-2 border-b">
          {selected.size}枚選択中
        </div>
        {COLOR_TABS.map(c => (
          <button
            key={c.value}
            onClick={() => applyColor(c.value)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs hover:opacity-80 transition-all font-medium"
            style={{ backgroundColor: c.value }}
            title={c.label}
          >
            {c.emoji} {c.label}
          </button>
        ))}
        <button
          onClick={() => applyColor(null)}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-gray-300 hover:bg-gray-50 text-gray-600"
        >
          ⬜ 色を消す
        </button>
        {singleSelected && (
          <a
            href={singleSelected.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-blue-600 border border-blue-200 hover:bg-blue-50"
          >
            🔗 開く
          </a>
        )}
        <div className="mt-auto pt-2 border-t border-gray-100">
          <button
            onClick={() => setSelected(new Set())}
            className="w-full px-2 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 text-left"
          >
            ✕ 全選択解除
          </button>
        </div>
      </div>

    </div>
  );
}
