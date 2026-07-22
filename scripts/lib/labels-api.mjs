const PATH = "/api/labels-shared";
const normalize = (baseUrl) => baseUrl.replace(/\/+$/, "");

export function buildReadRequest(baseUrl, token) {
  return {
    url: `${normalize(baseUrl)}${PATH}`,
    options: { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  };
}

export function buildWriteRequest(baseUrl, token, folderId, labels) {
  return {
    url: `${normalize(baseUrl)}${PATH}`,
    options: {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, labels }),
    },
  };
}

export function parseItemsResponse(json) {
  const items = json?.items ?? [];
  if (!Array.isArray(items)) throw new Error("items が配列ではありません");
  return items;
}
