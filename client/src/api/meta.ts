export async function getMeta() {
  return fetch("/api/meta", { credentials: "include" });
}
