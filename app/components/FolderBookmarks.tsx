"use client";

import { useState } from "react";
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

  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-400 font-medium shrink-0">📂 保存済み：</span>

        {bookmarks.map(b => (
          <div
            key={b.id}
            className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm border transition-colors group ${
              b.folderId === currentFolderId
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600"
            }`}
          >
            <button
              onClick={() => handleSwitch(b.folderId)}
              className="font-medium"
            >
              {b.name}
            </button>
            <button
              onClick={() => handleDelete(b.id)}
              className={`ml-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity ${
                b.folderId === currentFolderId ? "text-blue-200 hover:text-white" : "text-gray-400 hover:text-red-500"
              }`}
              title="削除"
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
                if (e.key === "Enter") handleAdd();
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
