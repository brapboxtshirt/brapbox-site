// Cloudflare Pages Function: POST /api/lead
// Emails quote and shop-visit requests from the website to the shop inbox via Resend.
// Needs the RESEND_API_KEY secret set in Cloudflare Pages > Settings > Variables and Secrets.
// Optional: LEAD_TO (defaults to brapboxtshirt@gmail.com) and LEAD_FROM.

const MAX_FIELD = 4000;

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
