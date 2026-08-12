(function () {
  let profileToken = "";
  let pollTimer = null;
  let lastVersion = "";
  let profileSalts = {};

  function base64Url(bytes) {
    let binary = "";
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function fromBase64Url(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  async function deriveCredential(password, salt) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(salt), iterations: 150000 }, key, 256);
    return base64Url(bits);
  }

  async function request(path, options = {}, token = profileToken) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer)) {
      headers.set("content-type", "application/json");
    }
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`/api/${path}`, { ...options, headers, cache: "no-store" });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new Error(data?.message || data?.error || `요청 실패 (${response.status})`);
    return data;
  }

  async function status() {
    const data = await request("auth/status", {}, "");
    profileSalts = data.salts || {};
    return { configured: true, ...data };
  }

  async function authenticateProfile(profile, password, setup = false) {
    const salt = setup
      ? base64Url(crypto.getRandomValues(new Uint8Array(16)))
      : profileSalts[profile];
    if (!salt) throw new Error("로그인 정보를 새로 불러온 뒤 다시 시도해주세요.");
    const credential = await deriveCredential(password, salt);
    const data = await request("auth", {
      method: "POST",
      body: JSON.stringify({ action: setup ? "setup_profile" : "login_profile", profile, salt, credential })
    }, "");
    profileSalts[profile] = salt;
    profileToken = data.token;
    return data;
  }

  async function loadAll() {
    const data = await request("data");
    lastVersion = data.version || "";
    return data.data;
  }

  async function uploadReceipt(file, id) {
    const extension = (file.type || "image/jpeg").split("/")[1] || "jpeg";
    const key = `${id}.${extension.replace(/[^a-z0-9]/gi, "")}`;
    await request(`receipts/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "content-type": file.type || "image/jpeg" },
      body: file
    });
    return key;
  }

  async function saveEntry(item, receiptFile) {
    const id = item.id || crypto.randomUUID();
    const receiptPath = receiptFile ? await uploadReceipt(receiptFile, id) : (item.receiptPath || null);
    return request("entries", {
      method: "POST",
      body: JSON.stringify({ ...item, id, receiptPath })
    });
  }

  async function deleteEntry(item) {
    return request(`entries/${encodeURIComponent(item.id)}`, { method: "DELETE" });
  }

  async function getReceiptUrl(path) {
    const data = await request(`receipts/${encodeURIComponent(path)}/url`);
    return data.url;
  }

  async function saveSettings(data) {
    return request("settings", { method: "POST", body: JSON.stringify(data) });
  }

  function subscribe(onChange) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const data = await request("version");
        if (lastVersion && data.version !== lastVersion) onChange();
      } catch (error) {
        console.warn("동기화 확인 실패", error);
      }
    }, 15000);
  }

  window.remoteStore = {
    configured: true,
    status,
    authenticateProfile,
    loadAll,
    saveEntry,
    deleteEntry,
    getReceiptUrl,
    saveSettings,
    subscribe
  };
})();
