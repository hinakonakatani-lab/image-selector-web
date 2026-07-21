export const labelsKey = (folderId) => `labels:shared:${folderId}`;
export const LABELS_SCAN_PATTERN = "labels:shared:*";
export const VOCAB_PLACES_KEY = "vocab:places";
export const VOCAB_SUBJECTS_KEY = "vocab:subjects";

// @upstash/redis の scan() は完了カーソルを数値 0 で返す場合と文字列 "0" で
// 返す場合の両方があるため、どちらも「完了」とみなす必要がある。
export const isScanComplete = (cursor) => String(cursor) === "0";
