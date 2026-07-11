"use client";

import { useSyncExternalStore } from "react";

export const FOLDER_TAG_VISIBILITY_STORAGE_KEY = "folderTagUIVisible";
const STORAGE_KEY = FOLDER_TAG_VISIBILITY_STORAGE_KEY;
export const FOLDER_TAG_VISIBILITY_EVENT = "foldertagvisibilitychange";

function subscribe(callback: () => void) {
  window.addEventListener(FOLDER_TAG_VISIBILITY_EVENT, callback);
  return () => window.removeEventListener(FOLDER_TAG_VISIBILITY_EVENT, callback);
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function getServerSnapshot() {
  return false;
}

// localStorageと同期しつつ、サーバー/初回クライアントレンダーのハイドレーション不一致を避ける
export function useFolderTagVisibility() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setFolderTagVisibility(on: boolean) {
  localStorage.setItem(STORAGE_KEY, String(on));
  window.dispatchEvent(new CustomEvent(FOLDER_TAG_VISIBILITY_EVENT, { detail: on }));
}

export default function FolderTagVisibilityToggle() {
  const on = useFolderTagVisibility();

  return (
    <button
      onClick={() => setFolderTagVisibility(!on)}
      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-gray-300 hover:border-gray-400 text-gray-600"
      title="本数振り分けタブの表示切り替え"
    >
      🔢
      <span
        className={`relative inline-block w-8 h-4 rounded-full transition-colors ${on ? "bg-red-500" : "bg-gray-300"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${on ? "translate-x-4" : ""}`}
        />
      </span>
    </button>
  );
}
