// Cloudflare Pages Function: POST /api/lead
// Emails quote and shop-visit requests from the website to the shop inbox via Resend.
// Needs the RESEND_API_KEY secret set in Cloudflare Pages > Settings > Variables and Secrets.
// Optional: LEAD_TO (defaults to brapboxtshirt@gmail.com) and LEAD_FROM.

const MAX_FIELD = 4000;

// Artwork attachments: files = [{ name, type, base64 }]
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // decoded size, all files together
const ALLOWED_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "ai", "eps", "psd", "tif", "tiff"];

function readFiles(list) {
  if (!Array.isArray(list) || !list.length) return { files: [] };
  if (list.length > MAX_FILES) return { error: "too_many_files" };
  const files = [];
  let total = 0;
  for (const f of list) {
    const name = clean(f && f.name).replace(/[\\/\r\n"]/g, "_").slice(0, 120) || "artwork";
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return { error: "file_type_not_allowed", file: name };
    let b64 = String((f && f.base64) || "").replace(/^data:[^,]*,/, "").replace(/\s/g, "");
    if (!b64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return { error: "bad_file", file: name };
    const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
    total += bytes;
    if (total > MAX_TOTAL_BYTES) return { error: "files_too_large" };
    files.push({ filename: name, content: b64 });
  }
  return { files };
}

function clean(v) {
  return String(v ?? "").slice(0, MAX_FIELD).trim();
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  // Honeypot: bots fill the hidden "Company website" field.
  if (clean(data.hp)) return json({ ok: true });

  const type = clean(data.type) === "visit" ? "visit" : "quote";
  const name = clean(data.name);
  const email = clean(data.email);
  const phone = clean(data.phone);
  if (!name || (!email && phone.replace(/\D/g, "").length < 10)) {
    return json({ ok: false, error: "missing_contact" }, 400);
  }

  const att = readFiles(data.files);
  if (att.error) return json({ ok: false, error: att.error, file: att.file }, 400);

  if (!env.RESEND_API_KEY) return json({ ok: false, error: "not_configured" }, 500);

  const ref = clean(data.ref);
  const rows = [
    ["Name", name],
    ["Business / team", clean(data.org)],
    ["Email", email],
    ["Phone", phone],
    ["Contact by", clean(data.contact)],
    ["Order", clean(data.summary)],
    ["When", clean(data.when)],
    ["Delivery", clean(data.ship)],
    ["Visit day / time", clean(data.visit)],
    ["Notes", clean(data.notes)],
    ["Reference", ref],
    ["Artwork attached", att.files.map((f) => f.filename).join(", ")],
  ].filter(([, v]) => v);

  const subject =
    type === "visit"
      ? `Shop visit request: ${name}`
      : `New quote request${ref ? " " + ref : ""}: ${name}`;

  const html =
    `<h2 style="font-family:sans-serif">${esc(subject)}</h2>` +
    `<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(k)}</td>` +
          `<td style="padding:6px 0;white-space:pre-wrap">${esc(v)}</td></tr>`
      )
      .join("") +
    `</table><p style="font-family:sans-serif;font-size:12px;color:#999">Sent from the brapboxscreenprinting.com website.</p>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");

  const payload = {
    from: env.LEAD_FROM || "BrapBox Website <onboarding@resend.dev>",
    to: [env.LEAD_TO || "brapboxtshirt@gmail.com"],
    subject,
    html,
    text,
  };
  if (/^\S+@\S+\.\S+$/.test(email)) payload.reply_to = email;
  if (att.files.length) payload.attachments = att.files;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.log("resend error", res.status, await res.text());
    return json({ ok: false, error: "send_failed" }, 502);
  }
  return json({ ok: true });
}

export function onRequest() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
