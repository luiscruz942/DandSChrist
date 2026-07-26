import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname } from "path";

dotenv.config();

const requiredEnv = [
    "MP_ACCESS_TOKEN",
    "EMAIL_USER",
    "EMAIL_APP_PASSWORD",
    "FIREBASE_SERVICE_ACCOUNT",
    "BASE_URL"
];

for (const env of requiredEnv) {
    if (!process.env[env]) {
        throw new Error(`Falta la variable de entorno ${env}`);
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const require    = createRequire(import.meta.url);

const app = express();
app.use(cors({ origin: "https://dandschrist.com" }));
app.use(express.json());
app.use(express.static(__dirname));

// ── Firebase Admin ─────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({
  credential: cert(serviceAccount),
});
const db = getFirestore();

// ── Mercado Pago ───────────────────────────────────────────────
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN.trim() });

const BASE_URL = process.env.BASE_URL;

if (!BASE_URL) {
  throw new Error("BASE_URL no está definida");
}

// ── Email (Nodemailer con Gmail) ────────────────────────────────
const OWNER_EMAIL = "luisdelacruz4032@gmail.com";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,           // luisdelacruz4032@gmail.com
    pass: process.env.EMAIL_APP_PASSWORD,   // contraseña de aplicación de 16 caracteres
  },
});

// ── Diagnóstico de arranque ──────────────────────────────────────
console.log("── Verificando configuración ──");
console.log("MP_ACCESS_TOKEN definido:", !!process.env.MP_ACCESS_TOKEN);
console.log("EMAIL_USER definido:", !!process.env.EMAIL_USER, process.env.EMAIL_USER ? `(${process.env.EMAIL_USER})` : "");
console.log("EMAIL_APP_PASSWORD definido:", !!process.env.EMAIL_APP_PASSWORD);

transporter.verify((err, success) => {
  if (err) {
    console.error("❌ Nodemailer NO pudo conectar con Gmail:", err.message);
    console.error("   → Revisa que EMAIL_USER y EMAIL_APP_PASSWORD estén bien en tu .env");
  } else {
    console.log("✅ Nodemailer conectado correctamente a Gmail, listo para enviar correos.");
  }
});

function buildOrderEmailHtml(orderData) {
  const { items, shipping, total, paymentId } = orderData;

  const itemsRows = (items || [])
    .map(i => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${i.name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${i.qty}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">$${(i.price * i.qty).toLocaleString('es-CO')}</td>
    </tr>`)
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
      <h2 style="color:#111;">Nuevo pedido confirmado ✅</h2>
      <p><strong>ID de pago:</strong> ${paymentId}</p>
      <p><strong>Cliente:</strong> ${shipping?.nombre || "—"}</p>
      <p><strong>Teléfono:</strong> ${shipping?.telefono || "—"}</p>
      <p><strong>Correo:</strong> ${shipping?.correo || "—"}</p>
      <p><strong>Dirección:</strong> ${shipping?.direccion || "—"}, ${shipping?.ciudad || ""}, ${shipping?.departamento || ""}</p>
      ${shipping?.notas ? `<p><strong>Notas:</strong> ${shipping.notas}</p>` : ""}
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:6px 10px;text-align:left;">Producto</th>
            <th style="padding:6px 10px;text-align:center;">Cant.</th>
            <th style="padding:6px 10px;text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
      </table>
      <p style="text-align:right;font-size:18px;margin-top:12px;">
        <strong>Total: $${(total || 0).toLocaleString('es-CO')} COP</strong>
      </p>
    </div>`;
}

async function sendOrderEmails(orderData) {
  const html = buildOrderEmailHtml(orderData);
  const customerEmail = orderData.shipping?.correo;

  // Correo al dueño
  try {
    await transporter.sendMail({
      from: `"DandS Pedidos" <${process.env.EMAIL_USER}>`,
      to: OWNER_EMAIL,
      subject: `🛒 Nuevo pedido — ${orderData.shipping?.nombre || "cliente"}`,
      html,
    });
    console.log("📧 Correo enviado al dueño");
  } catch (err) {
    console.error("❌ Error enviando correo al dueño:", err.message);
  }

  // Correo de confirmación al cliente
  if (customerEmail) {
    try {
      await transporter.sendMail({
        from: `"DandS" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: "✅ ¡Confirmamos tu pedido en DandS!",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
            <h2>¡Gracias por tu compra, ${orderData.shipping?.nombre || ""}! </h2>
            <p>Tu pago fue confirmado y ya estamos preparando tu pedido.</p>
            ${html}
            <p style="margin-top:16px;color:#555;">Te avisaremos cuando esté en camino.</p>
          </div>`,
      });
      console.log("📧 Correo de confirmación enviado al cliente");
    } catch (err) {
      console.error("❌ Error enviando correo al cliente:", err.message);
    }
  }
}

// ── Webhook ────────────────────────────────────────────────────
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  res.status(200).send("OK"); // Responde rápido a MP

  try {
    const body = JSON.parse(req.body.toString());
    console.log("📩 Webhook recibido:", JSON.stringify(body));

    // Solo procesar notificaciones de pago
    if (body.type !== "payment") return;

    const paymentId = body.data?.id;
    if (!paymentId) return;

    // Obtener detalles del pago — SDK v2 devuelve el objeto directo
    const payment = await new Payment(client).get({ id: paymentId });
    console.log(`💳 Pago ${paymentId} | Estado: ${payment.status}`);

    if (payment.status !== "approved") return;

    // El external_reference ahora es el ID del documento en pending_orders,
    // así que lo buscamos directamente por ID (no por preferenceId).
    const externalRef = payment.external_reference;
    console.log("🔎 Buscando pedido pendiente con ID:", externalRef);

    let pendingDoc = null;

    if (externalRef) {
      const docRef = db.collection("pending_orders").doc(externalRef);
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        pendingDoc = docSnap;
      }
    }

    // Fallback: tomar el más reciente si no encontró por ID
    // (solo debería pasar si external_reference vino vacío o desactualizado)
    if (!pendingDoc) {
      console.log("⚠️ No encontrado por ID, tomando el más reciente como fallback");
      const snapshot = await db.collection("pending_orders")
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

      if (!snapshot.empty) {
        pendingDoc = snapshot.docs[0];
      }
    }

    if (!pendingDoc) {
      console.log("⚠️ No hay pedidos pendientes en Firestore");
      return;
    }

    const pendingData = pendingDoc.data();

    const orderData = {
      items:        pendingData.items,
      shipping:     pendingData.shipping,
      paymentId:    String(paymentId),
      preferenceId: pendingData.preferenceId,
      total:        payment.transaction_amount,
      status:       "approved",
      createdAt:    new Date(),
    };

    // Guardar en orders y borrar de pending_orders
    await db.collection("orders").add(orderData);
    await pendingDoc.ref.delete();

    console.log("✅ ¡Pedido guardado en Firestore! Dashboard actualizado.");

    // Enviar correos (dueño + cliente) — no bloquea la respuesta al webhook
    await sendOrderEmails(orderData);

  } catch (err) {
    console.error("❌ Error en webhook:", err.message);
  }
});

// ── POST /create-preference ────────────────────────────────────
app.post("/create-preference", async (req, res) => {
  try {
    const { items, shipping } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
            error: "El carrito está vacío."
        });
    }

    if (!shipping) {
        return res.status(400).json({
            error: "No se recibieron datos de envío."
        });
    }

    // 1. Guardar primero el pedido pendiente para obtener un ID propio de Firestore.
    //    Este ID se usará como external_reference en Mercado Pago, para poder
    //    identificar el pedido exacto cuando llegue el webhook.
    const pendingRef = await db.collection("pending_orders").add({
      items,
      shipping,
      createdAt: new Date(),
    });

    // 2. Crear la preferencia en Mercado Pago usando ese ID como external_reference
    const response = await new Preference(client).create({
      body: {
        items: items.map(item => ({
          title:       String(item.name),
          quantity:    Number(item.qty),
          unit_price:  Number(item.price),
          currency_id: "COP",
        })),
        payer: {
          name:  shipping?.nombre  || "",
          phone: { number: shipping?.telefono || "" },
          address: {
            street_name: shipping?.direccion || "",
            city:        shipping?.ciudad    || "",
            zip_code:    "",
          },
        },
        additional_info: shipping
          ? `Envío: ${shipping.direccion}, ${shipping.ciudad}, ${shipping.departamento}${shipping.notas ? ` | ${shipping.notas}` : ""}`
          : "",
        notification_url: `${BASE_URL}/webhook`,
        back_urls: {
          success: `${BASE_URL}/Index.html`,
          failure: `${BASE_URL}/Index.html`,
          pending: `${BASE_URL}/Index.html`,
        },
        // external_reference vincula el pago con el pedido pendiente real
        external_reference: pendingRef.id,
      },
    });

    // 3. Guardar el preferenceId real de MP en el mismo documento pendiente
    await pendingRef.update({ preferenceId: response.id });

    console.log("✅ Preferencia creada:", response.id);
    console.log("📦 Pedido pendiente guardado en Firestore con ID:", pendingRef.id);
    res.json({ init_point: response.init_point });

  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "No se pudo crear la preferencia" });
  }
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 Servidor DandS activo en el puerto ${PORT}`);
    console.log(`🌐 Webhook: ${BASE_URL}/webhook`);
});
