// POST /api/hat-checkout -> { url } : a Square-hosted checkout link for a printed hat order.
// Needs Cloudflare Pages secrets:
//   SQUARE_ACCESS_TOKEN  (production access token from the Square Developer dashboard)
//   SQUARE_LOCATION_ID   (optional; defaults to the BrapBox Inc. location)
// Prices live here, not in the browser, so the customer can't change what they pay.

const STYLES = {
  yp6006:  { name: "Yupoong 6006",        cents: 1850 },
  ff180:   { name: "Flexfit 180 Delta",   cents: 2450 },
  ff180ap: { name: "Flexfit 180AP Delta", cents: 2450 },
};
const COLORS = ["Black", "Dark Gray", "Navy Blue", "White"];
const MIN = 24, MAX = 5000;
const SITE = "https://www.brapboxscreenprinting.com";
const DEFAULT_LOCATION = "W5N0H5DZGV7K7";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost({ request, env }) {
  if (!env.SQUARE_ACCESS_TOKEN) return json({ ok: false, error: "checkout_not_configured" }, 503);
  let d;
  try { d = await request.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }

  // items: [{ style, qty }, ...] — styles can be mixed; the 24 minimum is for the whole order
  const raw = Array.isArray(d.items) ? d.items : [];
  const items = [];
  for (const it of raw) {
    const st = STYLES[it && it.style];
    const q = Number.parseInt(it && it.qty, 10);
    if (!st || !(q >= 1 && q <= MAX) || items.some(x => x.st === st)) return json({ ok: false, error: "bad_request" }, 400);
    items.push({ st, q });
  }
  const total = items.reduce((t, x) => t + x.q, 0);
  const ref = String(d.ref || "");
  if (!items.length || !COLORS.includes(d.color) || total < MIN || total > MAX || !/^BB-H[\d-]{6,12}$/.test(ref)) {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const pre = {};
  if (/^\S+@\S+\.\S+$/.test(d.email || "")) pre.buyer_email = String(d.email).slice(0, 200);
  const digits = String(d.phone || "").replace(/\D/g, "");
  if (digits.length === 10) pre.buyer_phone_number = "+1" + digits;
  else if (digits.length === 11 && digits[0] === "1") pre.buyer_phone_number = "+" + digits;

  const body = {
    idempotency_key: ref + "-" + crypto.randomUUID(),
    description: `Printed hats order ${ref}`,
    order: {
      location_id: env.SQUARE_LOCATION_ID || DEFAULT_LOCATION,
      reference_id: ref,
      line_items: items.map(({ st, q }) => ({
        name: `Printed hat: ${st.name}, ${d.color}`,
        quantity: String(q),
        base_price_money: { amount: st.cents, currency: "USD" },
        note: `Order ${ref}. Front panel print.`,
      })),
    },
    checkout_options: {
      redirect_url: `${SITE}/printed-hats/?paid=${encodeURIComponent(ref)}`,
      ask_for_shipping_address: d.ship === "ship",
      merchant_support_email: "brapboxtshirt@gmail.com",
    },
    pre_populated_data: pre,
    payment_note: `Printed hats ${ref}`,
  };

  const r = await fetch("https://connect.squareup.com/v2/online-checkout/payment-links", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": "2024-10-17",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  const url = j && j.payment_link && j.payment_link.url;
  if (!r.ok || !url) {
    console.log("square checkout failed", r.status, JSON.stringify(j.errors || j).slice(0, 500));
    return json({ ok: false, error: "square_error" }, 502);
  }
  return json({ ok: true, url });
}
