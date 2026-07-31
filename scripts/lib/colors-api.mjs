const PATH = "/api/colors-shared";
const normalize = (baseUrl) => baseUrl.replace(/\/+$/, "");

export function buildReadRequest(baseUrl, token) {
  return {
    url: `${normalize(baseUrl)}${PATH}`,
    options: { method: "GET", headers: { Authorization: `Bearer ${token}` } },
  };
}

export function parseItemsResponse(json) {
  const items = json?.items ?? [];
  if (!Array.isArray(items)) throw new Error("items が配列ではありません");
  return items;
}
