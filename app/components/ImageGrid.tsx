"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { DriveFolder, DriveImage } from "@/app/api/drive/route";

const YELLOW = "#ffe599";
const GRAY = "#999999";

type DragRect = { x: number; y: number; w: number; h: number };

const COLOR_TABS = [
  { value: "#ea9999", label: "赤", emoji: "🟥" },
  { value: "#a4c2f4", label: "青", emoji: "🟦" },
  { value: "#b6d7a8", label: "緑", emoji: "🟩" },
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
  const [downloading, setDownloading] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [monthInput, setMonthInput] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<DriveImage | null>(null);
  const [cropPositions, setCropPositions] = useState<Record<string, { portrait: {x:number,y:number}; square: {x:number,y:number} }>>({});
  const cropDragRef = useRef<{ id:string; type:'portrait'|'square'; startX:number; startY:number; startPosX:number; startPosY:number } | null>(null);
  // ページ座標（scrollY込み）で開始点を保持
  const dragStartRef = useRef<{ pageX: number; pageY: number; imageId: string | null } | null>(null);
  const isDragSelectingRef = useRef(false);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const autoScrollRafRef = useRef<number | null>(null);
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

  // ラバーバンド選択のmousemove / mouseup / エッジスクロールをwindowで管理
  useEffect(() => {
    const SCROLL_ZONE = 80;  // 画面端からこのpx以内でスクロール開始
    const MAX_SPEED = 16;    // 最大スクロール速度(px/frame)

    // ビューポート座標からドラッグ枠を更新（スクロール中のrAFからも呼ぶ）
    const updateRect = (clientX: number, clientY: number) => {
      if (!dragStartRef.current) return;
      const startViewX = dragStartRef.current.pageX - window.scrollX;
      const startViewY = dragStartRef.current.pageY - window.scrollY;
      setDragRect({
        x: Math.min(clientX, startViewX),
        y: Math.min(clientY, startViewY),
        w: Math.abs(clientX - startViewX),
        h: Math.abs(clientY - startViewY),
      });
    };

    const stopAutoScroll = () => {
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };

    const startAutoScroll = () => {
      if (autoScrollRafRef.current !== null) return;
      const step = () => {
        if (!isDragSelectingRef.current) { autoScrollRafRef.current = null; return; }
        const y = lastMouseRef.current.y;
        const distBottom = window.innerHeight - y;
        const distTop = y;
        let speed = 0;
        if (distBottom < SCROLL_ZONE) speed = Math.ceil((1 - distBottom / SCROLL_ZONE) * MAX_SPEED);
        else if (distTop < SCROLL_ZONE) speed = -Math.ceil((1 - distTop / SCROLL_ZONE) * MAX_SPEED);
        if (speed !== 0) {
          window.scrollBy(0, speed);
          updateRect(lastMouseRef.current.x, lastMouseRef.current.y);
        }
        autoScrollRafRef.current = requestAnimationFrame(step);
      };
      autoScrollRafRef.current = requestAnimationFrame(step);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };

      const startPageX = dragStartRef.current.pageX;
      const startPageY = dragStartRef.current.pageY;
      const curPageX = e.clientX + window.scrollX;
      const curPageY = e.clientY + window.scrollY;
      const dx = curPageX - startPageX;
      const dy = curPageY - startPageY;
      if (!isDragSelectingRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        isDragSelectingRef.current = true;
      }
      if (isDragSelectingRef.current) {
        updateRect(e.clientX, e.clientY);
        const distBottom = window.innerHeight - e.clientY;
        const distTop = e.clientY;
        if (distBottom < SCROLL_ZONE || distTop < SCROLL_ZONE) startAutoScroll();
        else stopAutoScroll();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      stopAutoScroll();
      const start = dragStartRef.current;

      if (isDragSelectingRef.current) {
        // ページ座標で矩形を確定して判定
        const startPageX = start.pageX;
        const startPageY = start.pageY;
        const endPageX = e.clientX + window.scrollX;
        const endPageY = e.clientY + window.scrollY;
        const rectX = Math.min(startPageX, endPageX);
        const rectY = Math.min(startPageY, endPageY);
        const rectW = Math.abs(endPageX - startPageX);
        const rectH = Math.abs(endPageY - startPageY);
        const newIds: string[] = [];
        document.querySelectorAll("[data-image-id]").forEach(el => {
          const r = el.getBoundingClientRect();
          const elL = r.left + window.scrollX;
          const elR = r.right + window.scrollX;
          const elT = r.top + window.scrollY;
          const elB = r.bottom + window.scrollY;
          if (elL < rectX + rectW && elR > rectX && elT < rectY + rectH && elB > rectY) {
            const id = el.getAttribute("data-image-id");
            if (id) newIds.push(id);
          }
        });
        setSelected(prev => {
          const next = new Set(prev);
          newIds.forEach(id => next.add(id));
          return next;
        });
      } else if (start.imageId !== null) {
        const id = start.imageId;
        setSelected(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
      }

      dragStartRef.current = null;
      isDragSelectingRef.current = false;
      setDragRect(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (autoScrollRafRef.current !== null) cancelAnimationFrame(autoScrollRafRef.current);
    };
  }, []);

  // クロップビューのドラッグ位置調整
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!cropDragRef.current) return;
      const { id, type, startX, startY, startPosX, startPosY } = cropDragRef.current;
      const x = Math.max(0, Math.min(100, startPosX - (e.clientX - startX) * 0.3));
      const y = Math.max(0, Math.min(100, startPosY - (e.clientY - startY) * 0.3));
      setCropPositions(prev => ({
        ...prev,
        [id]: {
          portrait: prev[id]?.portrait ?? { x: 50, y: 50 },
          square:   prev[id]?.square   ?? { x: 50, y: 50 },
          [type]: { x, y },
        },
      }));
    };
    const onUp = () => { cropDragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ManualColorPickerからの手動着色を即時反映
  useEffect(() => {
    const onManualColor = (e: Event) => {
      const { fileId, color } = (e as CustomEvent<{ fileId: string; color: string | null }>).detail;
      setColors(prev => {
        const next = { ...prev };
        if (color) next[fileId] = color;
        else delete next[fileId];
        return next;
      });
    };
    window.addEventListener("manualColorApplied", onManualColor);
    return () => window.removeEventListener("manualColorApplied", onManualColor);
  }, []);

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    let el: HTMLElement | null = e.target as HTMLElement;
    let imageId: string | null = null;
    while (el && el !== e.currentTarget) {
      if (el.dataset.imageId) { imageId = el.dataset.imageId; break; }
      el = el.parentElement;
    }
    dragStartRef.current = { pageX: e.clientX + window.scrollX, pageY: e.clientY + window.scrollY, imageId };
    isDragSelectingRef.current = false;
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

    await fetch("/api/colors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, fileIds: ids, color }),
    });
    setSaving(false);
  }, [selected, folderId]);

  const handleOpenAllUrls = useCallback(() => {
    for (const id of selected) {
      const img = imageMap.current.get(id);
      if (!img) continue;
      const win = window.open(img.webViewLink, "_blank");
      if (!win) {
        alert("ポップアップがブロックされています。\nブラウザのアドレスバーに表示される「ポップアップがブロックされました」をクリックして、このサイトを許可してください。");
        return;
      }
    }
  }, [selected]);

  const handleBulkDownload = useCallback(async () => {
    const ids = Array.from(selected);
    setDownloading(true);
    try {
      for (const fileId of ids) {
        const res = await fetch("/api/drive/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        if (!res.ok) throw new Error("失敗");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const img = imageMap.current.get(fileId);
        a.download = img?.name || fileId;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      alert("ダウンロードに失敗しました");
    } finally {
      setDownloading(false);
    }
  }, [selected]);

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
    await fetch("/api/colors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, fileIds: ids, color: null }),
    });
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

  const colorTabFolders = folders
    .map(folder => ({
      ...folder,
      images: folder.images.filter(img => colors[img.id] === activeTab),
    }))
    .filter(folder => folder.images.length > 0);

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
        data-image-id={image.id}
        className="relative cursor-pointer rounded overflow-hidden select-none"
        style={{
          outline: isSelected
            ? "3px solid #3b82f6"
            : color ? `4px solid ${color}` : "none",
          backgroundColor: color || "#f0f0f0",
        }}
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
    <>
    {/* ラバーバンド選択の矩形オーバーレイ */}
    {dragRect && (
      <div
        className="fixed pointer-events-none z-50 border-2 border-blue-400 bg-blue-200/20"
        style={{ left: dragRect.x, top: dragRect.y, width: dragRect.w, height: dragRect.h }}
      />
    )}
    <div
      onMouseDown={handleContainerMouseDown}
      style={{
        marginLeft: selected.size > 0 ? SIDEBAR_W : 0,
        transition: "margin-left 0.3s ease",
        userSelect: dragRect ? "none" : undefined,
      }}
    >
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
            {colorTabImages.length > 0 && activeTab !== YELLOW && activeTab !== GRAY && (
              <button
                onClick={() => {
                  const ids = colorTabFolders.flatMap(f => f.images.map(img => img.id));
                  setSelected(new Set(ids));
                }}
                className="ml-auto text-sm px-3 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-colors"
              >
                ☑️ 全選択
              </button>
            )}
            {colorTabImages.length > 0 && (
              <button
                onClick={() => handleClearColorTab(activeTab)}
                className="text-sm px-3 py-1 rounded border border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400 transition-colors"
              >
                🗑️ この色を全て消す
              </button>
            )}
          </div>

          {colorTabFolders.length > 0 ? (
            <>
              {colorTabFolders.map(folder => (
                <div key={folder.id} className="mb-8">
                  <div className="bg-gray-200 font-bold px-3 py-2 rounded mb-2 text-sm text-gray-700">
                    📁 {folder.path}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
                    {folder.images.map(image => renderImage(image))}
                  </div>
                </div>
              ))}
            </>
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
        {selected.size === 1 && singleSelected && (
          <a
            href={singleSelected.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-blue-600 border border-blue-200 hover:bg-blue-50"
          >
            🔗 開く
          </a>
        )}
        {selected.size > 1 && (
          <button
            onClick={handleOpenAllUrls}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-blue-600 border border-blue-200 hover:bg-blue-50 text-left"
          >
            🔗 全て開く
          </button>
        )}
        <button
          onClick={handleBulkDownload}
          disabled={downloading}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-green-700 border border-green-300 hover:bg-green-50 disabled:opacity-50"
        >
          {downloading ? "⏳ DL中..." : selected.size === 1 ? "📦 DL" : "📦 一括DL"}
        </button>
        <button
          onClick={() => setShowPreview(true)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-purple-700 border border-purple-300 hover:bg-purple-50"
        >
          🔍 クロップ確認
        </button>
        <div className="mt-auto pt-2 border-t border-gray-100 flex flex-col gap-1">
          <div className="text-center py-1.5 rounded-lg bg-blue-500 text-white font-bold text-sm">
            {selected.size}枚選択中
          </div>
          <button
            onClick={() => setSelected(new Set())}
            className="w-full px-2 py-1.5 rounded-lg text-xs text-gray-500 border border-gray-300 hover:text-gray-700 hover:bg-gray-100 text-left"
          >
            ✕ 全選択解除
          </button>
        </div>
      </div>

    </div>

    {/* クロップ確認ポップアップ */}
    {showPreview && (
      <div
        className="fixed inset-0 bg-black/70 z-50 overflow-y-auto py-8 px-4"
        onClick={e => { if (e.target === e.currentTarget) setShowPreview(false); }}
      >
        <div className="bg-white rounded-xl w-full max-w-3xl mx-auto p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-bold text-base text-gray-800">{selected.size}枚のクロップ確認</h2>
            <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
          </div>
          <div className="flex flex-col gap-8">
            {Array.from(selected).map(id => {
              const img = imageMap.current.get(id);
              if (!img) return null;
              const portraitPos = cropPositions[id]?.portrait ?? { x: 50, y: 50 };
              const squarePos   = cropPositions[id]?.square   ?? { x: 50, y: 50 };
              return (
                <div key={id} className="border border-gray-200 rounded-lg p-4">
                  {/* ファイル名 + ドライブリンク */}
                  <div className="flex items-center gap-2 mb-3 min-w-0">
                    <span className="text-xs text-gray-500 truncate" title={img.name}>📄 {img.name}</span>
                    <a
                      href={img.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-xs text-blue-500 hover:underline"
                    >🔗 ドライブで開く</a>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {/* オリジナル（虫眼鏡で拡大） */}
                    <div>
                      <p className="text-xs text-center text-gray-500 mb-1 font-medium">オリジナル</p>
                      <div
                        className="relative group bg-gray-100 rounded overflow-hidden flex items-center justify-center cursor-zoom-in"
                        style={{ minHeight: 120 }}
                        onClick={() => setZoomedImage(img)}
                      >
                        <img src={img.thumbnailUrl} alt={img.name} className="w-full object-contain max-h-60 pointer-events-none" draggable={false} />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                          <span className="text-white text-3xl drop-shadow">🔍</span>
                        </div>
                      </div>
                    </div>
                    {/* 4:5 縦（ドラッグで位置調整） */}
                    <div>
                      <p className="text-xs text-center text-gray-500 mb-1 font-medium">4:5（縦）</p>
                      <div
                        className="bg-gray-100 rounded overflow-hidden w-full cursor-grab active:cursor-grabbing select-none"
                        style={{ aspectRatio: "4/5" }}
                        onMouseDown={e => {
                          e.preventDefault();
                          cropDragRef.current = { id, type: "portrait", startX: e.clientX, startY: e.clientY, startPosX: portraitPos.x, startPosY: portraitPos.y };
                        }}
                      >
                        <img src={img.thumbnailUrl} alt={img.name} className="w-full h-full object-cover pointer-events-none" draggable={false}
                          style={{ objectPosition: `${portraitPos.x}% ${portraitPos.y}%` }} />
                      </div>
                      <p className="text-xs text-center text-gray-400 mt-1">ドラッグで位置調整</p>
                    </div>
                    {/* 1:1 スクエア（ドラッグで位置調整） */}
                    <div>
                      <p className="text-xs text-center text-gray-500 mb-1 font-medium">1:1（スクエア）</p>
                      <div
                        className="bg-gray-100 rounded overflow-hidden w-full cursor-grab active:cursor-grabbing select-none"
                        style={{ aspectRatio: "1/1" }}
                        onMouseDown={e => {
                          e.preventDefault();
                          cropDragRef.current = { id, type: "square", startX: e.clientX, startY: e.clientY, startPosX: squarePos.x, startPosY: squarePos.y };
                        }}
                      >
                        <img src={img.thumbnailUrl} alt={img.name} className="w-full h-full object-cover pointer-events-none" draggable={false}
                          style={{ objectPosition: `${squarePos.x}% ${squarePos.y}%` }} />
                      </div>
                      <p className="text-xs text-center text-gray-400 mt-1">ドラッグで位置調整</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}

    {/* オリジナル画像の拡大表示 */}
    {zoomedImage && (
      <div
        className="fixed inset-0 bg-black/85 z-[60] flex items-center justify-center p-6 cursor-zoom-out"
        onClick={() => setZoomedImage(null)}
      >
        <img
          src={zoomedImage.thumbnailUrl}
          alt={zoomedImage.name}
          className="max-w-full max-h-full object-contain rounded shadow-2xl pointer-events-none"
          draggable={false}
        />
        <button
          className="absolute top-4 right-4 text-white text-3xl leading-none hover:text-gray-300"
          onClick={() => setZoomedImage(null)}
        >×</button>
      </div>
    )}
    </>
  );
}
