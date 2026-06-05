export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-4 py-3 flex items-center shadow-sm sticky top-0 z-40">
        <h1 className="text-lg font-bold">🖼️ 画像選定ツール</h1>
      </header>
      <main className="max-w-screen-2xl mx-auto px-4 py-6">
        <div className="flex flex-col items-center justify-center py-32 gap-5 text-gray-500">
          <svg
            className="animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            width="40" height="40" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <p className="text-base font-medium">Google Driveから画像を読み込んでいます...</p>
          <p className="text-sm text-gray-400">フォルダの枚数によって数秒〜数十秒かかることがあります</p>
        </div>
      </main>
    </div>
  );
}
