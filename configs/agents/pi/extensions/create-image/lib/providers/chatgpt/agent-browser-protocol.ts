export interface ChatGptSubmitResult {
  ok: boolean;
  error?: string;
  text?: string;
}

export interface ChatGptAssetPointer {
  assetPointer: string;
  fileId: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  status?: string;
}

export interface ChatGptAssetPollResult {
  ok: boolean;
  conversationId?: string;
  status?: number;
  assets: ChatGptAssetPointer[];
  error?: string;
  text?: string;
}

export interface ChatGptImageDownloadResult {
  ok: boolean;
  status: number;
  contentType: string | null;
  bytes: number;
  magicHex: string;
  base64?: string;
  error?: string;
}

export interface ChatGptDetectedImageType {
  mimeType: string;
  extension: string;
}

export function parseAgentBrowserJsonOutput<T>(output: string): T {
  const trimmed = output.trim();
  const parsed = JSON.parse(trimmed) as unknown;
  return (typeof parsed === "string" ? JSON.parse(parsed) : parsed) as T;
}

export function buildSubmitPromptScript(prompt: string): string {
  return `(() => {
  const prompt = ${JSON.stringify(prompt)};
  const el = document.querySelector('#prompt-textarea') || document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
  if (!el) return JSON.stringify({ ok: false, error: 'ChatGPT prompt input was not found.' });
  el.focus();
  if (el.tagName === 'TEXTAREA') {
    el.value = prompt;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
  } else {
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, prompt);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
  }
  return JSON.stringify({ ok: true });
})()`;
}

export function buildPollAssetsScript(): string {
  return `(async () => {
  const conversationId = location.pathname.match(/^\\/c\\/([^/]+)/)?.[1] || null;
  if (!conversationId) return JSON.stringify({ ok: false, error: 'ChatGPT conversation id was not found in the URL.', assets: [], text: document.body.innerText.slice(-1000) });
  const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });
  const session = await sessionRes.json();
  if (!session.accessToken) return JSON.stringify({ ok: false, error: 'ChatGPT access token was not available from /api/auth/session.', conversationId, status: sessionRes.status, assets: [] });
  const response = await fetch('/backend-api/conversation/' + conversationId, {
    credentials: 'include',
    headers: { authorization: 'Bearer ' + session.accessToken },
  });
  const data = await response.json();
  const assets = [];
  const seen = new Set();
  for (const node of Object.values(data.mapping || {})) {
    const message = node && node.message;
    const parts = (message && message.content && message.content.parts) || [];
    for (const part of parts) {
      if (!part || part.content_type !== 'image_asset_pointer' || typeof part.asset_pointer !== 'string') continue;
      if (seen.has(part.asset_pointer)) continue;
      seen.add(part.asset_pointer);
      assets.push({
        assetPointer: part.asset_pointer,
        fileId: part.asset_pointer.replace(/^(?:sediment|file-service):\\/\\//, ''),
        sizeBytes: part.size_bytes,
        width: part.width,
        height: part.height,
        status: message.status,
      });
    }
  }
  return JSON.stringify({ ok: true, conversationId, status: response.status, assets });
})()`;
}

export function buildDownloadImageScript(conversationId: string, fileId: string): string {
  return `(async () => {
  const conversationId = ${JSON.stringify(conversationId)};
  const fileId = ${JSON.stringify(fileId)};
  const sessionRes = await fetch('/api/auth/session', { credentials: 'include' });
  const session = await sessionRes.json();
  if (!session.accessToken) return JSON.stringify({ ok: false, error: 'ChatGPT access token was not available from /api/auth/session.', status: sessionRes.status, contentType: null, bytes: 0, magicHex: '' });
  const downloadRes = await fetch('/backend-api/files/download/' + fileId + '?conversation_id=' + conversationId + '&inline=false', {
    credentials: 'include',
    headers: { authorization: 'Bearer ' + session.accessToken },
  });
  const downloadInfo = await downloadRes.json();
  if (!downloadInfo.download_url) return JSON.stringify({ ok: false, error: 'ChatGPT did not return a generated image download URL.', status: downloadRes.status, contentType: null, bytes: 0, magicHex: '' });
  const imageRes = await fetch(downloadInfo.download_url, { credentials: 'include' });
  const bytes = new Uint8Array(await imageRes.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.slice(index, index + chunk));
  return JSON.stringify({
    ok: imageRes.ok,
    status: imageRes.status,
    contentType: imageRes.headers.get('content-type'),
    bytes: bytes.length,
    magicHex: Array.from(bytes.slice(0, 16)).map((byte) => byte.toString(16).padStart(2, '0')).join(''),
    base64: btoa(binary),
  });
})()`;
}

export function detectChatGptImageType(bytes: Uint8Array, contentType: string | null): ChatGptDetectedImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (contentType?.toLowerCase().startsWith("image/png")) return { mimeType: "image/png", extension: "png" };
  if (contentType?.toLowerCase().startsWith("image/jpeg")) return { mimeType: "image/jpeg", extension: "jpg" };
  if (contentType?.toLowerCase().startsWith("image/webp")) return { mimeType: "image/webp", extension: "webp" };
  return null;
}
