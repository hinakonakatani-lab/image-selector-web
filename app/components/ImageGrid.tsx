"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import type { DriveFolder, DriveImage } from "@/app/api/drive/route";
import { useFolderTagVisibility } from "@/app/components/FolderTagVisibilityToggle";

const YELLOW = "#ffe599";
const GRAY = "#999999";

type DragRect = { x: number; y: number; w: number; h: number };
type MemoEntry = { text: string; authorName: string; updatedAt: string };

const NUMBER_TAB_PREFIX = "num:";

const COLOR_TABS = [
  { value: "#ea9999", label: "赤", emoji: "🟥" },
  { value: "#a4c2f4", label: "青", emoji: "🟦" },
  { value: "#b6d7a8", label: "緑", emoji: "🟩" },
  { value: "#b4a7d6", label: "紫", emoji: "🟪" },
  { value: "#ffe599", label: "黄（候補）", emoji: "🟨" },
  { value: "#999999", label: "グレー（NG）", emoji: "⬛" },
];

function RenameInput({
  fileId,
  initialValue,
  originalName,
  onSave,
}: {
  fileId: string;
  initialValue: string;
  originalName: string;
  onSave: (fileId: string, name: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <input
      type="text"
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initialValue) onSave(fileId, value);
      }}
      placeholder={originalName}
      className="w-full text-xs px-1 py-0.5 border rounded mt-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
    />
  );
}

type Props = {
  folders: DriveFolder[];
  folderId: string;
  initialColors: Record<string, string>;
  initialMonths: Record<string, string>;
  initialMemos: Record<string, MemoEntry>;
  initialFolderTagCount: number;
  initialFolderTags: Record<string, number>;
  initialRenameMap: Record<string, string>;
  userName: string;
};

export default function ImageGrid({ folders, folderId, initialColors, initialMonths, initialMemos, initialFolderTagCount, initialFolderTags, initialRenameMap, userName }: Props) {
  const [colors, setColors] = useState<Record<string, string>>(initialColors);
  const [months, setMonths] = useState<Record<string, string>>(initialMonths);
  const [folderTags, setFolderTags] = useState<Record<string, number>>(initialFolderTags);
  const [folderTagCount, setFolderTagCount] = useState<number>(initialFolderTagCount);
  const [renameMap, setRenameMap] = useState<Record<string, string>>(initialRenameMap);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const showFolderTagUI = useFolderTagVisibility();
  const [editingFolderTagCount, setEditingFolderTagCount] = useState(false);
  const [folderTagCountInput, setFolderTagCountInput] = useState("");
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
  const [searchQuery, setSearchQuery] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [zoomedImage, setZoomedImage] = useState<DriveImage | null>(null);
  const [lastRandomIds, setLastRandomIds] = useState<Set<string>>(new Set());
  const [randomViewMode, setRandomViewMode] = useState<"flat" | "folder">("flat");
  const [colorViewMode, setColorViewMode] = useState<"flat" | "folder">("folder");
  const [cropPositions, setCropPositions] = useState<Record<string, { portrait: {x:number,y:number}; square: {x:number,y:number} }>>({});
  const [memos, setMemos] = useState<Record<string, MemoEntry>>(initialMemos);
  const [memoModal, setMemoModal] = useState<string | null>(null);
  const [memoEditText, setMemoEditText] = useState("");
  const [headerHeight, setHeaderHeight] = useState(57);
  const cropDragRef = useRef<{ id:string; type:'portrait'|'square'; startX:number; startY:number; startPosX:number; startPosY:number } | null>(null);
  // ページ座標（scrollY込み）で開始点を保持
  const dragStartRef = useRef<{ pageX: number; pageY: number; imageId: string | null } | null>(null);
  const isDragSelectingRef = useRef(false);
  const lastMouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const autoScrollRafRef = useRef<number | null>(null);
  const imageMap = useRef<Map<string, DriveImage>>(new Map());

  // useLayoutEffect でペイント前に同期計測 → ユーザーが誤位置を見ることがない
  useLayoutEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const update = () => setHeaderHeight(Math.ceil(header.getBoundingClientRect().height));
    // ペイント前に即時計測
    update();
    // 画面幅変化（ヘッダー折り返し等）にも追随
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // 全画像のマップを構築（Drive URLアクセス用）
  useEffect(() => {
    imageMap.current.clear();
    for (const folder of folders) {
      for (const image of folder.images) {
        imageMap.current.set(image.id, image);
      }
    }
  }, [folders]);

  // 本数振り分けUIがOFFになったら、本目タブを表示中なら「全て」に戻す
  useEffect(() => {
    if (!showFolderTagUI) {
      setActiveTab(current => (current.startsWith(NUMBER_TAB_PREFIX) ? "all" : current));
    }
  }, [showFolderTagUI]);

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

  const applyFolderTag = useCallback(async (tag: number | null) => {
    if (selected.size === 0) return;
    setSaving(true);
    const ids = Array.from(selected);

    setFolderTags(prev => {
      const next = { ...prev };
      for (const id of ids) {
        if (tag === null) delete next[id];
        else next[id] = tag;
      }
      return next;
    });
    setSelected(new Set());

    await fetch("/api/folder-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, fileIds: ids, tag }),
    });
    setSaving(false);
  }, [selected, folderId]);

  const saveFolderTagCount = useCallback(async (count: number) => {
    setFolderTagCount(count);
    await fetch("/api/folder-tag-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, count }),
    });
  }, [folderId]);

  const saveRename = useCallback(async (fileId: string, name: string) => {
    setRenameMap(prev => {
      const next = { ...prev };
      if (!name) delete next[fileId];
      else next[fileId] = name;
      return next;
    });
    await fetch("/api/rename-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, fileId, name: name || null }),
    });
  }, [folderId]);

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

  const handleRandomSelect = useCallback(() => {
    // 未着色画像をフォルダごとに収集
    const byFolder = new Map<string, { image: DriveImage; path: string }[]>();
    for (const folder of folders) {
      for (const image of folder.images) {
        if (!colors[image.id]) {
          if (!byFolder.has(folder.path)) byFolder.set(folder.path, []);
          byFolder.get(folder.path)!.push({ image, path: folder.path });
        }
      }
    }
    const uncolored = Array.from(byFolder.values()).flat();
    if (uncolored.length === 0) return;

    // 前回選定を除外（残りが50枚未満なら全体から選ぶ）
    const afterExclusion = uncolored.filter(({ image }) => !lastRandomIds.has(image.id));
    const pool = afterExclusion.length >= 50 ? afterExclusion : uncolored;
    const target = Math.min(50, pool.length);

    // フォルダ別に再グループ化
    const poolByFolder = new Map<string, { image: DriveImage; path: string }[]>();
    for (const item of pool) {
      if (!poolByFolder.has(item.path)) poolByFolder.set(item.path, []);
      poolByFolder.get(item.path)!.push(item);
    }

    // Fisher-Yates シャッフル
    for (const [, images] of poolByFolder) {
      for (let i = images.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [images[i], images[j]] = [images[j], images[i]];
      }
    }

    // フォルダ比率に応じた層化抽出（クラスタリング防止）
    const total = pool.length;
    const folderKeys = Array.from(poolByFolder.keys());
    const allocations = folderKeys.map(key => ({
      key,
      alloc: Math.floor((poolByFolder.get(key)!.length / total) * target),
    }));
    let allocated = allocations.reduce((s, a) => s + a.alloc, 0);
    // 端数を小数部が大きい順に割り当て
    folderKeys
      .map((key, i) => ({ i, frac: (poolByFolder.get(key)!.length / total) * target - allocations[i].alloc }))
      .sort((a, b) => b.frac - a.frac)
      .slice(0, target - allocated)
      .forEach(({ i }) => { allocations[i].alloc++; });

    const result: string[] = [];
    for (const { key, alloc } of allocations) {
      const images = poolByFolder.get(key)!;
      for (let i = 0; i < Math.min(alloc, images.length); i++) {
        result.push(images[i].image.id);
      }
    }

    const newIds = new Set(result);
    setLastRandomIds(newIds);
    setSelected(new Set());
    setActiveTab("random");
  }, [folders, colors, lastRandomIds]);

  // 全画像をパス付きでフラット化（handleClearColorTabで使うため先に宣言）
  const allImagesWithPath = folders.flatMap(folder =>
    folder.images.map(image => ({ image, path: folder.path }))
  );

  const downloadZipBlob = useCallback(async (
    files: { fileId: string; name?: string; folderLabel?: string }[],
    zipName: string
  ) => {
    if (files.length === 0) return;
    setDownloadingZip(true);
    try {
      const res = await fetch("/api/drive/download-zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      if (!res.ok) throw new Error("失敗");
      const failedCount = Number(res.headers.get("X-Failed-Count") || 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipName;
      a.click();
      URL.revokeObjectURL(url);
      if (failedCount > 0) {
        alert(`${failedCount}件のダウンロードに失敗しました`);
      }
    } catch {
      alert("ダウンロードに失敗しました");
    } finally {
      setDownloadingZip(false);
    }
  }, []);

  const downloadAllFolderTagsZip = useCallback(() => {
    const files = allImagesWithPath
      .filter(({ image }) => folderTags[image.id])
      .map(({ image }) => ({
        fileId: image.id,
        name: renameMap[image.id] || undefined,
        folderLabel: `${folderTags[image.id]}本目`,
      }));
    downloadZipBlob(files, "全本目.zip");
  }, [allImagesWithPath, folderTags, renameMap, downloadZipBlob]);


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

  const openMemoModal = useCallback((imageId: string) => {
    setMemoModal(imageId);
    setMemoEditText(memos[imageId]?.text || "");
  }, [memos]);

  const saveMemo = useCallback(async () => {
    if (!memoModal) return;
    const text = memoEditText.trim();
    const imageId = memoModal;
    setMemos(prev => {
      const next = { ...prev };
      if (!text) delete next[imageId];
      else next[imageId] = { text, authorName: userName, updatedAt: new Date().toISOString() };
      return next;
    });
    setMemoModal(null);
    await fetch("/api/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, fileId: imageId, text: text || null }),
    });
  }, [memoModal, memoEditText, folderId, userName]);

  const deleteMemo = useCallback(async () => {
    if (!memoModal) return;
    const imageId = memoModal;
    setMemos(prev => { const next = { ...prev }; delete next[imageId]; return next; });
    setMemoModal(null);
    await fetch("/api/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, fileId: imageId, text: null }),
    });
  }, [memoModal, folderId]);

  const handleBulkDeleteMemos = useCallback(async () => {
    const ids = Array.from(selected).filter(id => memos[id]);
    if (ids.length === 0) return;
    setMemos(prev => { const next = { ...prev }; ids.forEach(id => delete next[id]); return next; });
    await fetch("/api/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, fileIds: ids, text: null }),
    });
  }, [selected, memos, folderId]);

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

  const activeFolderTagNum = activeTab.startsWith(NUMBER_TAB_PREFIX)
    ? Number(activeTab.slice(NUMBER_TAB_PREFIX.length))
    : null;

  const folderTagNumbers = Array.from({ length: folderTagCount }, (_, i) => i + 1);

  const folderTagCountsByNum = folderTagNumbers.reduce((acc, n) => {
    acc[n] = allImagesWithPath.filter(({ image }) => folderTags[image.id] === n).length;
    return acc;
  }, {} as Record<number, number>);

  const folderTagFolders = activeFolderTagNum !== null
    ? folders
      .map(folder => ({
        ...folder,
        images: folder.images.filter(img => folderTags[img.id] === activeFolderTagNum),
      }))
      .filter(folder => folder.images.length > 0)
    : [];

  const colorTabImages = activeTab !== "all"
    ? allImagesWithPath.filter(({ image }) => colors[image.id] === activeTab)
    : [];

  const colorTabFolders = folders
    .map(folder => ({
      ...folder,
      images: folder.images.filter(img => colors[img.id] === activeTab),
    }))
    .filter(folder => folder.images.length > 0);

  const searchTerms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchesSearch = (path: string) => {
    const lower = path.toLowerCase();
    return searchTerms.every(term => lower.includes(term));
  };
  const filteredSortedFolders = searchTerms.length > 0
    ? sortedFolders.filter(f => matchesSearch(f.path))
    : sortedFolders;
  const filteredColorTabFolders = searchTerms.length > 0
    ? colorTabFolders.filter(f => matchesSearch(f.path))
    : colorTabFolders;

  const filteredFolderTagFolders = searchTerms.length > 0
    ? folderTagFolders.filter(f => matchesSearch(f.path))
    : folderTagFolders;

  const downloadFolderTagZip = useCallback((n: number) => {
    const files = filteredFolderTagFolders
      .flatMap(folder => folder.images)
      .filter(image => folderTags[image.id] === n)
      .map(image => ({
        fileId: image.id,
        name: renameMap[image.id] || undefined,
      }));
    downloadZipBlob(files, `${n}本目.zip`);
  }, [filteredFolderTagFolders, folderTags, renameMap, downloadZipBlob]);

  const allCount = allImagesWithPath.filter(({ image }) => colors[image.id] !== GRAY).length;
  const uncoloredCount = allImagesWithPath.filter(({ image }) => !colors[image.id]).length;

  const singleSelected = selected.size === 1
    ? imageMap.current.get([...selected][0])
    : null;

  const selectedWithMemos = Array.from(selected).filter(id => memos[id]).length;

  const colorTabAllIds = filteredColorTabFolders.flatMap(f => f.images.map(img => img.id));
  const colorTabAllSelected = colorTabAllIds.length > 0 && colorTabAllIds.every(id => selected.has(id));

  const renderImage = (image: DriveImage, path?: string) => {
    const color = colors[image.id];
    const isSelected = selected.has(image.id);
    const memo = memos[image.id];
    return (
      <div
        key={image.id}
        data-image-id={image.id}
        className="relative cursor-pointer rounded overflow-hidden select-none group"
        style={{
          outline: isSelected
            ? "3px solid #3b82f6"
            : color ? `4px solid ${color}` : "none",
          backgroundColor: color || "#f0f0f0",
        }}
        title={image.name}
      >
        <div className="relative flex items-center justify-center bg-gray-100" style={{ height: "160px" }}>
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
          {/* 本目タグバッジ（常時表示） */}
          {folderTags[image.id] && (
            <div className="absolute top-1 left-1 z-10 bg-black/70 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {folderTags[image.id]}
            </div>
          )}
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
          {/* カラーバー */}
          {color && !isSelected && (
            <div className="absolute bottom-0 left-0 right-0 h-1.5" style={{ backgroundColor: color }} />
          )}
        </div>
        {/* メモ */}
        <button
          className={`w-full text-left text-xs px-1 py-0.5 truncate transition-colors ${
            memo
              ? "bg-yellow-50 text-gray-700 hover:bg-yellow-100"
              : "text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-gray-50"
          }`}
          onClick={() => openMemoModal(image.id)}
          title={memo?.text}
        >
          {memo ? `📝 ${memo.text}` : "＋ メモ"}
        </button>
        {path && (
          <div className="text-xs text-gray-600 px-1 py-0.5 bg-white truncate" title={path}>
            📁 {path}
          </div>
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

      {/* タブ + 検索（スクロール追従） */}
      <div className="sticky z-20 bg-white -mx-4 px-4 shadow-sm" style={{ top: headerHeight }}>
        <div className="flex flex-wrap gap-1 border-b py-1">
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
          <button
            onClick={() => setActiveTab("random")}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "random"
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            🎲 ランダム選定
            {lastRandomIds.size > 0 && (
              <span className="ml-1 text-xs font-normal text-orange-500">（{lastRandomIds.size}枚）</span>
            )}
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
          <button
            onClick={() => { setShowImport(v => !v); setImportStatus(""); }}
            className="ml-auto self-center text-xs px-2 py-1 rounded border border-gray-300 hover:border-gray-400 text-gray-500"
          >
            📥 インポート
          </button>
        </div>
        {showFolderTagUI && (
          <div className="flex flex-wrap items-center gap-1 border-b py-1 bg-purple-50/60">
            {folderTagNumbers.map(n => (
              <button
                key={n}
                onClick={() => setActiveTab(`${NUMBER_TAB_PREFIX}${n}`)}
                className={`px-2 py-1 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === `${NUMBER_TAB_PREFIX}${n}`
                    ? "border-purple-500 text-purple-700"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {n}本目（{folderTagCountsByNum[n] || 0}）
              </button>
            ))}
            {editingFolderTagCount ? (
              <span className="flex items-center gap-1 self-center ml-1">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={folderTagCountInput}
                  onChange={e => setFolderTagCountInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      saveFolderTagCount(Math.max(1, Number(folderTagCountInput) || 1));
                      setEditingFolderTagCount(false);
                    }
                    if (e.key === "Escape") setEditingFolderTagCount(false);
                  }}
                  className="w-14 border rounded px-1 py-0.5 text-xs"
                  autoFocus
                />
                <button
                  onClick={() => {
                    saveFolderTagCount(Math.max(1, Number(folderTagCountInput) || 1));
                    setEditingFolderTagCount(false);
                  }}
                  className="text-xs px-2 py-0.5 rounded bg-blue-500 text-white"
                >
                  保存
                </button>
              </span>
            ) : (
              <button
                onClick={() => { setEditingFolderTagCount(true); setFolderTagCountInput(String(folderTagCount)); }}
                className="text-xs px-2 py-1 self-center text-gray-400 hover:text-gray-600"
                title="本数を設定"
              >
                ⚙️ {folderTagCount}本まで
              </button>
            )}
            <button
              onClick={downloadAllFolderTagsZip}
              disabled={downloadingZip}
              className="text-xs px-3 py-1 self-center rounded border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50"
            >
              {downloadingZip ? "⏳ DL中..." : "📦 全てダウンロード"}
            </button>
          </div>
        )}
        {/* 検索バー */}
        <div className="flex items-center gap-2 py-1.5 border-b">
          <span className="text-gray-400 text-sm shrink-0">🔍</span>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="フォルダパスで絞り込み..."
            className="flex-1 text-xs px-2 py-0.5 border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {searchQuery && (
            <>
              <span className="text-xs text-gray-400 shrink-0">
                {(activeTab === "all" ? filteredSortedFolders.length : filteredColorTabFolders.length)}フォルダ一致
              </span>
              <button
                onClick={() => setSearchQuery("")}
                className="text-xs text-gray-400 hover:text-gray-600 shrink-0 px-1"
              >✕</button>
            </>
          )}
        </div>
      </div>

      {/* インポートパネル */}
      {showImport && (
        <div className="mb-4 mt-2 p-4 bg-gray-50 border rounded-lg">
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

      <div className="mb-4" />

      {/* 全てタブ */}
      {activeTab === "all" && (
        <>

          {filteredSortedFolders.map(folder => (
            <div key={folder.id} className="mb-8">
              <div className="bg-gray-200 font-bold px-3 py-2 rounded mb-2 text-sm text-gray-700 flex items-center">
                📁 {folder.path}
                <button
                  onClick={() => setSelected(prev => {
                    const next = new Set(prev);
                    const allSel = folder.images.every(img => next.has(img.id));
                    if (allSel) folder.images.forEach(img => next.delete(img.id));
                    else folder.images.forEach(img => next.add(img.id));
                    return next;
                  })}
                  className="ml-auto text-gray-400 hover:text-gray-700 hover:bg-gray-300 transition-colors rounded px-1.5 py-0.5 text-xs font-normal"
                  title="このフォルダを全選択/全解除"
                >{folder.images.every(img => selected.has(img.id)) ? "☑ 全解除" : "☑ 全選択"}</button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
                {folder.images.map(image => renderImage(image))}
              </div>
            </div>
          ))}
          {filteredSortedFolders.length === 0 && (
            <div className="text-center text-gray-400 py-10">
              {searchQuery ? `「${searchQuery}」に一致するフォルダはありません` : "画像がありません"}
            </div>
          )}
        </>
      )}

      {/* ランダム選定タブ */}
      {activeTab === "random" && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <button
              onClick={handleRandomSelect}
              disabled={uncoloredCount === 0}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
            >
              🎲 ランダムで選定（50枚）
            </button>
            <span className="text-xs text-gray-500">
              未着色: {uncoloredCount}枚
              {lastRandomIds.size > 0 && (
                <span className="ml-1 text-gray-400">（前回の{lastRandomIds.size}枚を除外して再選定）</span>
              )}
            </span>
            {lastRandomIds.size > 0 && (
              <div className="ml-auto flex items-center rounded-lg border border-gray-200 overflow-hidden text-xs">
                <button
                  onClick={() => setRandomViewMode("flat")}
                  className={`px-3 py-1.5 transition-colors ${randomViewMode === "flat" ? "bg-gray-700 text-white" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  ☰ 一覧
                </button>
                <button
                  onClick={() => setRandomViewMode("folder")}
                  className={`px-3 py-1.5 transition-colors ${randomViewMode === "folder" ? "bg-gray-700 text-white" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  📁 フォルダ別
                </button>
              </div>
            )}
          </div>

          {lastRandomIds.size > 0 ? (
            <>
              {randomViewMode === "flat" ? (
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
                  {allImagesWithPath
                    .filter(({ image }) => lastRandomIds.has(image.id))
                    .map(({ image, path }) => renderImage(image, path))}
                </div>
              ) : (
                folders
                  .map(folder => ({
                    ...folder,
                    images: folder.images.filter(img => lastRandomIds.has(img.id)),
                  }))
                  .filter(folder => folder.images.length > 0)
                  .map(folder => (
                    <div key={folder.id} className="mb-8">
                      <div className="bg-gray-200 font-bold px-3 py-2 rounded mb-2 text-sm text-gray-700">
                        📁 {folder.path}
                        <span className="ml-2 font-normal text-gray-500">（{folder.images.length}枚）</span>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
                        {folder.images.map(image => renderImage(image))}
                      </div>
                    </div>
                  ))
              )}
            </>
          ) : (
            <div className="text-center text-gray-400 py-20">
              <p className="text-4xl mb-4">🎲</p>
              <p>「ランダムで選定」ボタンを押すと、未着色の画像から50枚がここに表示されます</p>
            </div>
          )}
        </div>
      )}

      {/* 色別タブ */}
      {activeTab !== "all" && activeTab !== "random" && activeFolderTagNum === null && (
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
            {filteredColorTabFolders.length > 0 && activeTab !== YELLOW && activeTab !== GRAY && (
              <button
                onClick={() => {
                  if (colorTabAllSelected) {
                    setSelected(prev => { const next = new Set(prev); colorTabAllIds.forEach(id => next.delete(id)); return next; });
                  } else {
                    setSelected(prev => { const next = new Set(prev); colorTabAllIds.forEach(id => next.add(id)); return next; });
                  }
                }}
                className="text-sm px-3 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-colors"
              >
                {colorTabAllSelected ? "☑️ 全選択解除" : "☑️ 全選択"}
              </button>
            )}
            {filteredColorTabFolders.length > 0 && activeTab !== GRAY && (
              <div className="ml-auto flex items-center rounded-lg border border-gray-200 overflow-hidden text-xs">
                <button
                  onClick={() => setColorViewMode("flat")}
                  className={`px-3 py-1.5 transition-colors ${colorViewMode === "flat" ? "bg-gray-700 text-white" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  ☰ 一覧
                </button>
                <button
                  onClick={() => setColorViewMode("folder")}
                  className={`px-3 py-1.5 transition-colors ${colorViewMode === "folder" ? "bg-gray-700 text-white" : "text-gray-500 hover:bg-gray-100"}`}
                >
                  📁 フォルダ別
                </button>
              </div>
            )}
          </div>

          {filteredColorTabFolders.length > 0 ? (
            <>
              {colorViewMode === "flat" && activeTab !== GRAY ? (
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
                  {filteredColorTabFolders.flatMap(folder =>
                    folder.images.map(image => renderImage(image))
                  )}
                </div>
              ) : (
                filteredColorTabFolders.map(folder => (
                  <div key={folder.id} className="mb-8">
                    <div className="bg-gray-200 font-bold px-3 py-2 rounded mb-2 text-sm text-gray-700 flex items-center">
                      📁 {folder.path}
                      <button
                        onClick={() => setSelected(prev => {
                          const next = new Set(prev);
                          const allSel = folder.images.every(img => next.has(img.id));
                          if (allSel) folder.images.forEach(img => next.delete(img.id));
                          else folder.images.forEach(img => next.add(img.id));
                          return next;
                        })}
                        className="ml-auto text-gray-400 hover:text-gray-700 hover:bg-gray-300 transition-colors rounded px-1.5 py-0.5 text-xs font-normal"
                        title="このフォルダを全選択/全解除"
                      >{folder.images.every(img => selected.has(img.id)) ? "☑ 全解除" : "☑ 全選択"}</button>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
                      {folder.images.map(image => renderImage(image))}
                    </div>
                  </div>
                ))
              )}
            </>
          ) : (
            <div className="text-center text-gray-400 py-10">
              {searchQuery ? `「${searchQuery}」に一致するフォルダはありません` : "この色がついた画像はまだありません"}
            </div>
          )}
        </>
      )}

      {/* 本目タグ別フィルタ表示 */}
      {activeFolderTagNum !== null && (
        <>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-sm text-gray-500">
              {activeFolderTagNum}本目：{filteredFolderTagFolders.reduce((sum, f) => sum + f.images.length, 0)}枚
            </span>
            <button
              onClick={() => downloadFolderTagZip(activeFolderTagNum)}
              disabled={downloadingZip || filteredFolderTagFolders.length === 0}
              className="ml-auto text-sm px-3 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-50"
            >
              {downloadingZip ? "⏳ DL中..." : `📦 ${activeFolderTagNum}本目をダウンロード`}
            </button>
          </div>

          {filteredFolderTagFolders.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
              {filteredFolderTagFolders.flatMap(folder => folder.images).map(image => (
                <div key={image.id}>
                  {renderImage(image)}
                  <RenameInput
                    fileId={image.id}
                    initialValue={renameMap[image.id] || ""}
                    originalName={image.name}
                    onSave={saveRename}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-10">
              {searchQuery ? `「${searchQuery}」に一致するフォルダはありません` : "この本目にはまだ画像がありません"}
            </div>
          )}
        </>
      )}

      {/* 選択中の左サイドバー */}
      <div
        className="fixed left-0 bottom-0 z-30 bg-white border-r border-gray-200 shadow-md flex flex-col gap-1 py-3 px-2 overflow-y-auto"
        style={{
          top: headerHeight,
          width: SIDEBAR_W,
          transform: selected.size > 0 ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s ease",
        }}
      >
        {COLOR_TABS.map(c => (
          <button
            key={c.value}
            onClick={() => {
              if (c.value === GRAY) {
                setConfirmDialog({
                  message: `選択中の ${selected.size}枚 をグレー（NG）にします。よろしいですか？`,
                  onConfirm: () => applyColor(c.value),
                });
              } else {
                applyColor(c.value);
              }
            }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs hover:opacity-80 transition-all font-medium"
            style={{ backgroundColor: c.value }}
            title={c.label}
          >
            {c.emoji} {c.label}
          </button>
        ))}
        <button
          onClick={() => setConfirmDialog({
            message: `選択中の ${selected.size}枚 の色を消します。よろしいですか？`,
            onConfirm: () => applyColor(null),
          })}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-gray-300 hover:bg-gray-50 text-gray-600"
        >
          ⬜ 色を消す
        </button>
        {showFolderTagUI && folderTagNumbers.map(n => (
          <button
            key={n}
            onClick={() => applyFolderTag(n)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-purple-300 hover:bg-purple-50 text-purple-700 font-medium"
          >
            🔢 {n}本目
          </button>
        ))}
        {showFolderTagUI && (
          <button
            onClick={() => applyFolderTag(null)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-gray-300 hover:bg-gray-50 text-gray-600"
          >
            ⬜ 本目を消す
          </button>
        )}
        {selected.size === 1 && (
          <button
            onClick={() => openMemoModal([...selected][0])}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-yellow-700 border border-yellow-300 hover:bg-yellow-50"
          >
            📝 {memos[[...selected][0]] ? "メモ編集" : "メモ追加"}
          </button>
        )}
        {selectedWithMemos > 0 && selected.size > 1 && (
          <button
            onClick={() => setConfirmDialog({ message: `選択中の ${selectedWithMemos}件 のメモを削除します。よろしいですか？`, onConfirm: handleBulkDeleteMemos })}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-yellow-700 border border-yellow-300 hover:bg-yellow-50"
          >
            📝 メモ削除（{selectedWithMemos}件）
          </button>
        )}
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
          onClick={() => setShowPreview(true)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-purple-700 border border-purple-300 hover:bg-purple-50"
        >
          🔍 クロップ確認
        </button>
        <div className="mt-auto flex flex-col gap-1">
          <button
            onClick={handleBulkDownload}
            disabled={downloading}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-green-700 border border-green-300 hover:bg-green-50 disabled:opacity-50"
          >
            {downloading ? "⏳ DL中..." : selected.size === 1 ? "📦 DL" : "📦 一括DL"}
          </button>
          <div className="border-t border-gray-100 pt-3 flex flex-col gap-1">
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
                  {/* ファイル名 + ドライブリンク + DL */}
                  <div className="flex items-center gap-2 mb-3 min-w-0">
                    <span className="text-xs text-gray-500 truncate" title={img.name}>📄 {img.name}</span>
                    <a
                      href={img.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-xs text-blue-500 hover:underline"
                    >🔗 ドライブで開く</a>
                    <button
                      className="shrink-0 text-xs text-blue-500 hover:underline"
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/drive/download", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ fileId: img.id }),
                          });
                          if (!res.ok) throw new Error("失敗");
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = img.name;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch {
                          alert("ダウンロードに失敗しました");
                        }
                      }}
                    >📦 DL</button>
                  </div>
                  {/* オリジナル（全幅表示） */}
                  <div className="mb-3">
                    <p className="text-xs text-center text-gray-500 mb-1 font-medium">オリジナル</p>
                    <div
                      className="relative group bg-gray-100 rounded overflow-hidden flex items-center justify-center cursor-zoom-in w-full"
                      onClick={() => setZoomedImage(img)}
                    >
                      <img
                        src={img.thumbnailUrl.replace(/=s\d+$/, '=s800')}
                        alt={img.name}
                        className="w-full object-contain pointer-events-none"
                        draggable={false}
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                        <span className="text-white text-3xl drop-shadow">🔍</span>
                      </div>
                    </div>
                  </div>
                  {/* クロッププレビュー（2列） */}
                  <div className="grid grid-cols-2 gap-3">
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

    {/* メモモーダル */}
    {memoModal && (
      <div
        className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4"
        onClick={e => { if (e.target === e.currentTarget) setMemoModal(null); }}
      >
        <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
          <h3 className="font-bold text-sm mb-1">📝 メモ</h3>
          {imageMap.current.get(memoModal) && (
            <p className="text-xs text-gray-400 mb-3 truncate" title={imageMap.current.get(memoModal)!.name}>
              {imageMap.current.get(memoModal)!.name}
            </p>
          )}
          {memos[memoModal] && (
            <p className="text-xs text-gray-400 mb-2">
              最終更新: {memos[memoModal].authorName} · {new Date(memos[memoModal].updatedAt).toLocaleDateString("ja-JP")}
            </p>
          )}
          <textarea
            value={memoEditText}
            onChange={e => setMemoEditText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveMemo();
              if (e.key === "Escape") setMemoModal(null);
            }}
            placeholder="メモを入力..."
            className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
            rows={4}
            autoFocus
          />
          <div className="flex items-center gap-2 mt-4">
            {memos[memoModal] && (
              <button
                onClick={() => setConfirmDialog({ message: "このメモを削除しますか？", onConfirm: deleteMemo })}
                className="px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded hover:bg-red-50"
              >
                削除
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => setMemoModal(null)}
                className="px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={saveMemo}
                className="px-4 py-1.5 text-sm text-white bg-yellow-500 hover:bg-yellow-600 rounded font-medium"
              >
                保存
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-right">⌘/Ctrl+Enter で保存</p>
        </div>
      </div>
    )}

    {/* 確認ダイアログ */}
    {confirmDialog && (
      <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 max-w-sm w-full shadow-xl">
          <p className="text-sm text-gray-700 mb-6 leading-relaxed">{confirmDialog.message}</p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setConfirmDialog(null)}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
            >キャンセル</button>
            <button
              onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
              className="px-4 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600"
            >削除する</button>
          </div>
        </div>
      </div>
    )}

    {/* オリジナル画像の拡大表示（Driveプレビュー埋め込み） */}
    {zoomedImage && (
      <div
        className="fixed inset-0 bg-black/85 z-[60] flex flex-col items-center justify-center p-6"
        onClick={e => { if (e.target === e.currentTarget) setZoomedImage(null); }}
      >
        <div className="relative w-full max-w-4xl" style={{ height: "80vh" }}>
          <iframe
            src={`https://drive.google.com/file/d/${zoomedImage.id}/preview`}
            className="w-full h-full rounded-lg shadow-2xl bg-white"
            allow="autoplay"
            title={zoomedImage.name}
          />
        </div>
        <div className="flex items-center gap-4 mt-3">
          <span className="text-white text-sm opacity-70 truncate max-w-xs">{zoomedImage.name}</span>
          <a
            href={zoomedImage.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white text-xs border border-white/40 rounded px-3 py-1 hover:bg-white/20"
            onClick={e => e.stopPropagation()}
          >🔗 ドライブで開く</a>
          <button
            className="text-white text-xs border border-white/40 rounded px-3 py-1 hover:bg-white/20"
            onClick={async e => {
              e.stopPropagation();
              const fileId = zoomedImage.id;
              const name = zoomedImage.name;
              try {
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
                a.download = name;
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                alert("ダウンロードに失敗しました");
              }
            }}
          >📦 DL</button>
          <button
            className="text-white text-xs border border-white/40 rounded px-3 py-1 hover:bg-white/20"
            onClick={() => setZoomedImage(null)}
          >✕ 閉じる</button>
        </div>
      </div>
    )}
    </>
  );
}
