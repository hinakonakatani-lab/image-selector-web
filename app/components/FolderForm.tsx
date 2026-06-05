"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FolderForm({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setLoading(true);
    router.push(`?folderId=${encodeURIComponent(value.trim())}`);
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex gap-2">
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="GoogleドライブのフォルダIDを入力（URLの末尾のランダムな文字列）"
        className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading}
        className="bg-blue-500 hover:bg-blue-600 disabled:opacity-70 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex items-center gap-2"
      >
        {loading && (
          <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        )}
        {loading ? "読み込み中..." : "読み込む"}
      </button>
    </form>
  );
}
