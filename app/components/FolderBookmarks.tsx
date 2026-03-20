"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type Bookmark = { id: string; name: string; folderId: string };

type Props = {
  initialBookmarks: Bookmark[];
  currentFolderId: string;
};

export default function FolderBookmarks({ initialBookmarks, currentFolderId }: Props) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);
  const [adding, setAdding] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const router = useRouter();

  const handleAdd = async () => {
    const name = nameInput.trim();
    if (!name || !currentFolderId) return;
    const res = await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, folderId: currentFolderId }),
    });
    const data = await res.json();
    setBookmarks(prev => [...prev, data.bookmark]);
    setNameInput("");
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    await fetch("/api/bookmarks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBookmarks(prev => prev.filter(b => b.id !== id));
  };

  const handleSwitch = (folderId: string) => {
    router.push(`/?folderId=${folderId}`);
  };

  // ドラッグ＆ドロップ
  const handleDragStart = (id: string) => {
    dragId.current = id;
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (dragId.current !== id) setDragOverId(id);
  };

  const handleDrop = async (targetId: string) => {
    if (!dragId.current || dragId.current === targetId) {
      setDragOverId(null);
      return;
    }
    const from = bookmarks.findIndex(b => b.id === dragId.current);
    const to = bookmarks.findIndex(b => b.id === targetId);
    const next = [...bookmarks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setBookmarks(next);
    setDragOverId(null);
    dragId.current = null;
    await fetch("/api/bookmarks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarks: next }),
    });
  };

  const handleDragEnd = () => {
    setDragOverId(null);
    dragId.current = null;
  };

  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-400 font-medium shrink-0">📂 保存済み：</span>

        {bookmarks.map(b => (
          <div
            key={b.id}
            draggable
            onDragStart={() => handleDragStart(b.id)}
            onDragOver={e => handleDragOver(e, b.id)}
            onDrop={() => handleDrop(b.id)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-1 rounded-full px-2 py-1 text-sm border transition-all group cursor-grab active:cursor-grabbing select-none ${
              b.folderId === currentFolderId
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600"
            } ${dragOverId === b.id ? "ring-2 ring-blue-400 scale-105" : ""}`}
          >
            {/* ドラッグハンドル */}
            <span
              className={`text-xs px-0.5 cursor-grab ${
                b.folderId === currentFolderId ? "text-blue-200" : "text-gray-300"
              }`}
              title="ドラッグして並び替え"
            >
              ⠿
            </span>
            <button
              onClick={() => handleSwitch(b.folderId)}
              className="font-medium"
              draggable={false}
            >
              {b.name}
            </button>
            <button
              onClick={() => handleDelete(b.id)}
              className={`ml-0.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity ${
                b.folderId === currentFolderId ? "text-blue-200 hover:text-white" : "text-gray-400 hover:text-red-500"
              }`}
              title="削除"
              draggable={false}
            >
              ✕
            </button>
          </div>
        ))}

        {/* 追加ボタン */}
        {currentFolderId && !adding && (
          <button
            onClick={() => { setAdding(true); setNameInput(""); }}
            className="rounded-full px-3 py-1 text-sm border border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
          >
            ＋ このフォルダを保存
          </button>
        )}

        {adding && (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) handleAdd();
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="例：〇〇会社"
              className="border rounded-full px-3 py-1 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-400"
              autoFocus
            />
            <button
              onClick={handleAdd}
              className="bg-blue-500 hover:bg-blue-600 text-white text-sm px-3 py-1 rounded-full"
            >
              保存
            </button>
            <button
              onClick={() => setAdding(false)}
              className="text-gray-400 hover:text-gray-600 text-sm px-2"
            >
              キャンセル
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
