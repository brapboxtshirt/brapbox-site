// POST /api/sticker-checkout -> { url } : a Square-hosted checkout link for a custom sticker order.
// Needs Cloudflare Pages secrets:
//   SQUARE_ACCESS_TOKEN  (production access token from the Square Developer dashboard)
//   SQUARE_LOCATION_ID   (optional; defaults to the BrapBox Inc. location)
// Prices live here, not in the browser, so the customer can't change what they pay.

// PRICING: price per pack in cents, by size. null = not priced yet (checkout stays off).
// Keep in sync with PRICES on custom-stickers/index.html.
const SIZES = { "2": '2" x 2"', "3": '3" x 3"', "4": '4" x 4"' };
const PACKS = [50, 100, 250];
const PACK_CENTS = {
  "2": { 50: 4000, 100: 5000, 250: 7500 },
  "3": { 50: 5000, 100: 6200, 250: 9500 },
  "4": { 50: 6200, 100: 7800, 250: 12000 },
};
const SHAPES = { square: "Square", circle: "Circle", diecut: "Die cut" };
const SITE = "https://www.brapboxscreenprinting.com";
const DEFAULT_LOCATION = "W5N0H5DZGV7K7";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost({ request, env }) {
  if (!env.SQUARE_ACCESS_TOKEN) return json({ ok: false, error: "checkout_not_configured" }, 503);
  let d;
  try { d = await request.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }

  const sz = SIZES[d.size], shape = SHAPES[d.shape];
  const q = Number.parseInt(d.qty, 10);
  const ref = String(d.ref || "");
  if (!sz || !shape || !PACKS.includes(q) || !/^BB-S[\d-]{6,12}$/.test(ref)) return json({ ok: false, error: "bad_request" }, 400);
  const cents = PACK_CENTS[d.size][q];
  if (cents == null) return json({ ok: false, error: "not_priced" }, 503);

  const pre = {};
  if (/^\S+@\S+\.\S+$/.test(d.email || "")) pre.buyer_email = String(d.email).slice(0, 200);
  const digits = String(d.phone || "").replace(/\D/g, "");
  if (digits.length === 10) pre.buyer_phone_number = "+1" + digits;
  else if (digits.length === 11 && digits[0] === "1") pre.buyer_phone_number = "+" + digits;

  const body = {
    idempotency_key: ref + "-" + crypto.randomUUID(),
    description: `Custom stickers order ${ref}`,
    order: {
      location_id: env.SQUARE_LOCATION_ID || DEFAULT_LOCATION,
      reference_id: ref,
      line_items: [{
        name: `Custom stickers: ${q}-pack, ${shape}, ${sz}`,
        quantity: "1",
        base_price_money: { amount: cents, currency: "USD" },
        note: `Order ${ref}. ${q} stickers.`,
      }],
    },
    checkout_options: {
      redirect_url: `${SITE}/custom-stickers/?paid=${encodeURIComponent(ref)}`,
      ask_for_shipping_address: d.ship === "ship",
      merchant_support_email: "brapboxtshirt@gmail.com",
      enable_coupon: false,
      accepted_payment_methods: { apple_pay: true, google_pay: true, cash_app_pay: true, afterpay_clearpay: true },
    },
    pre_populated_data: pre,
    payment_note: `Custom stickers ${ref}`,
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
