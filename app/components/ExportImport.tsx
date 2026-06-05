"use client";

import { useRef, useState } from "react";

export default function ExportImport({ folderId }: { folderId?: string }) {
  const [status, setStatus] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (!folderId) return;
    setStatus("バックアップ中...");
    const res = await fetch(`/api/export?folderId=${folderId}`);
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `backup-${folderId}-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("✅ バックアップ完了");
    setTimeout(() => setStatus(""), 3000);
  };

  const handleAdminBackup = async () => {
    setStatus("全データ取得中...");
    const res = await fetch("/api/admin-backup");
    if (!res.ok) {
      setStatus("❌ バックアップに失敗しました");
      return;
    }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `admin-backup-all-drives-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`✅ ${data.totalFolders}件のドライブIDをバックアップしました`);
    setTimeout(() => setStatus(""), 4000);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("インポート中...");
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      setStatus("❌ ファイルの読み込みに失敗しました");
      return;
    }
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (res.ok) {
      setStatus(`✅ ${result.restoredFolders}フォルダ・${result.restoredBookmarks}ブックマークを復元しました`);
      setTimeout(() => { setStatus(""); window.location.reload(); }, 2000);
    } else {
      setStatus(`❌ ${result.error}`);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleAdminBackup}
        className="text-xs px-2 py-1 rounded border border-orange-300 text-orange-500 hover:border-orange-400 hover:text-orange-700 transition-colors"
        title="登録済み全ドライブIDの色・月データを丸ごとバックアップ（管理者用）"
      >
        📦 全データBK(管理者用)
      </button>
      {folderId && (
        <button
          onClick={handleExport}
          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
          title={`表示中のフォルダ（${folderId}）の色・月データをバックアップ`}
        >
          💾 このフォルダをBK
        </button>
      )}
      <label
        className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
        title="バックアップファイルから復元"
      >
        📂 復元
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImport}
        />
      </label>
      {status && <span className="text-xs text-gray-600">{status}</span>}
    </div>
  );
}
