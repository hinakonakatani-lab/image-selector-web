import { test } from "node:test";
import assert from "node:assert/strict";
import { createThumbRefreshQueue, nextThumbStatus } from "./thumb-refresh-queue.ts";

test("初回の失敗は取り直し中になる", () => {
  assert.equal(nextThumbStatus(false), "retrying");
});

test("取り直し済みのURLでも失敗したら諦める", () => {
  // キューは同じfileIdを二度リクエストしないので、ここで "retrying" のままにすると
  // 「読み込み中…」が永久に消えなくなる。
  assert.equal(nextThumbStatus(true), "failed");
});

// schedule を手動で進められるフェイク。テストが待ち時間に依存しないようにする。
function manualScheduler() {
  let pending: (() => void) | null = null;
  return {
    schedule: (fn: () => void) => {
      pending = fn;
    },
    flush: async () => {
      const fn = pending;
      pending = null;
      fn?.();
      // enqueue → fetch → onResolved の非同期チェーンを消化させる
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    },
    get hasPending() {
      return pending !== null;
    },
  };
}

test("同じ待ち時間内のenqueueは1回のリクエストにまとまる", async () => {
  const batches: string[][] = [];
  const timer = manualScheduler();
  const q = createThumbRefreshQueue({
    fetchUrls: async (ids) => {
      batches.push(ids);
      return {};
    },
    onResolved: () => {},
    schedule: timer.schedule,
  });

  q.enqueue("a");
  q.enqueue("b");
  q.enqueue("c");
  await timer.flush();

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], ["a", "b", "c"]);
});

test("取得できたURLをonResolvedに渡す", async () => {
  const received: Record<string, string>[] = [];
  const timer = manualScheduler();
  const q = createThumbRefreshQueue({
    fetchUrls: async () => ({ a: "https://lh3/a=s300" }),
    onResolved: (urls) => received.push(urls),
    schedule: timer.schedule,
  });

  q.enqueue("a");
  await timer.flush();

  assert.deepEqual(received, [{ a: "https://lh3/a=s300" }]);
});

test("同じfileIdは二度リクエストしない", async () => {
  const batches: string[][] = [];
  const timer = manualScheduler();
  const q = createThumbRefreshQueue({
    fetchUrls: async (ids) => {
      batches.push(ids);
      return {};
    },
    onResolved: () => {},
    schedule: timer.schedule,
  });

  q.enqueue("a");
  await timer.flush();
  q.enqueue("a");
  await timer.flush();

  assert.equal(batches.length, 1, "取り直しに失敗した画像を無限に叩き続けてはいけない");
});

test("別の待ち時間に入ったenqueueは別リクエストになる", async () => {
  const batches: string[][] = [];
  const timer = manualScheduler();
  const q = createThumbRefreshQueue({
    fetchUrls: async (ids) => {
      batches.push(ids);
      return {};
    },
    onResolved: () => {},
    schedule: timer.schedule,
  });

  q.enqueue("a");
  await timer.flush();
  q.enqueue("b");
  await timer.flush();

  assert.deepEqual(batches, [["a"], ["b"]]);
});

test("リクエストが失敗しても例外を投げない", async () => {
  const timer = manualScheduler();
  const q = createThumbRefreshQueue({
    fetchUrls: async () => {
      throw new Error("network down");
    },
    onResolved: () => {},
    schedule: timer.schedule,
  });

  q.enqueue("a");
  await assert.doesNotReject(() => timer.flush());
});

test("待ち時間のタイマーは1バッチにつき1回だけ張る", async () => {
  let scheduled = 0;
  const timer = manualScheduler();
  const q = createThumbRefreshQueue({
    fetchUrls: async () => ({}),
    onResolved: () => {},
    schedule: (fn) => {
      scheduled++;
      timer.schedule(fn);
    },
  });

  q.enqueue("a");
  q.enqueue("b");
  q.enqueue("c");

  assert.equal(scheduled, 1);
});

test("何もenqueueしなければリクエストしない", async () => {
  let called = 0;
  const timer = manualScheduler();
  createThumbRefreshQueue({
    fetchUrls: async () => {
      called++;
      return {};
    },
    onResolved: () => {},
    schedule: timer.schedule,
  });

  await timer.flush();

  assert.equal(called, 0);
});
