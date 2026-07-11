"use client";

import { useState } from "react";

export const FOLDER_TAG_VISIBILITY_STORAGE_KEY = "folderTagUIVisible";
const STORAGE_KEY = FOLDER_TAG_VISIBILITY_STORAGE_KEY;
export const FOLDER_TAG_VISIBILITY_EVENT = "foldertagvisibilitychange";

export default function FolderTagVisibilityToggle() {
  const [on, setOn] = useState(() => typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY) === "true");

  const toggle = () => {
    const next = !on;
    setOn(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(new CustomEvent(FOLDER_TAG_VISIBILITY_EVENT, { detail: next }));
  };

  return (
    <button
      onClick={toggle}
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
