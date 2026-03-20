"use client";

import { useState, useCallback } from "react";
import ColorPicker from "./ColorPicker";
import type { DriveFolder, DriveImage } from "@/app/api/drive/route";

const YELLOW = "#ffe599";

type Props = {
  folders: DriveFolder[];
  folderId: string;
  initialColors: Record<string, string>;
};

type Popup = {
  image: DriveImage;
  x: number;
  y: number;
} | null;

export default function ImageGrid({ folders, folderId, initialColors }: Props) {
  const [colors, setColors] = useState<Record<string, string>>(initialColors);
  const [popup, setPopup] = useState<Popup>(null);
  const [saving, setSaving] = useState(false);

  const handleImageClick = useCallback(
    (image: DriveImage, e: React.MouseEvent) => {
      e.stopPropagation();
      if (popup?.image.id === image.id) {
        setPopup(null);
        return;
      }
      // ポップアップの位置を計算（画面からはみ出さないように）
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

      // 楽観的更新（先にUIに反映）
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

      // サーバーに保存
      await fetch("/api/colors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, fileId, color }),
      });
      setSaving(false);
    },
    [popup, folderId]
  );

  // 黄色の画像をフォルダ内先頭に並び替え
  const sortedFolders = folders.map((folder) => ({
    ...folder,
    images: [...folder.images].sort((a, b) => {
      const aYellow = colors[a.id] === YELLOW;
      const bYellow = colors[b.id] === YELLOW;
      if (aYellow && !bYellow) return -1;
      if (!aYellow && bYellow) return 1;
      return 0;
    }),
  }));

  return (
    <div onClick={() => setPopup(null)}>
      {saving && (
        <div className="fixed top-4 right-4 bg-blue-500 text-white px-3 py-1 rounded text-sm z-50">
          保存中...
        </div>
      )}

      {/* カラーピッカーポップアップ */}
      {popup && (
        <div
          className="fixed z-50"
          style={{ left: popup.x, top: popup.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <ColorPicker
            currentColor={colors[popup.image.id] ?? null}
            onSelect={handleColorSelect}
          />
        </div>
      )}

      {sortedFolders.map((folder) => (
        <div key={folder.id} className="mb-8">
          {/* フォルダ名ヘッダー */}
          <div className="bg-gray-200 font-bold px-3 py-2 rounded mb-2 text-sm text-gray-700">
            📁 {folder.path}
          </div>

          {/* 画像グリッド */}
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-1">
            {folder.images.map((image) => {
              const color = colors[image.id];
              return (
                <div
                  key={image.id}
                  className="relative cursor-pointer rounded overflow-hidden aspect-square"
                  style={{
                    outline: color ? `4px solid ${color}` : "none",
                    backgroundColor: color || "#f0f0f0",
                  }}
                  onClick={(e) => handleImageClick(image, e)}
                  title={image.name}
                >
                  <img
                    src={image.thumbnailUrl}
                    alt={image.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {/* 色バッジ */}
                  {color && (
                    <div
                      className="absolute bottom-0 left-0 right-0 h-2"
                      style={{ backgroundColor: color }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
