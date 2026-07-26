// ================================
//   DandS - Firestore + Cloudinary
// ================================

import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Firebase config ───────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAbxMnSGugq2w3hIWjieSm25bHSrLSvF2s",
  authDomain: "tiendadands-eb4f6.firebaseapp.com",
  projectId: "tiendadands-eb4f6",
  storageBucket: "tiendadands-eb4f6.firebasestorage.app",
  messagingSenderId: "676650803052",
  appId: "1:676650803052:web:8da790cb4aa0a0ac075d49",
  measurementId: "G-VBXZEH8MS1"
};

// ── Cloudinary config ─────────────────────────────────────────
const CLOUDINARY_CLOUD_NAME    = "dpxkfgjyw";
const CLOUDINARY_UPLOAD_PRESET = "TiendaDandS";

// ── Init ──────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);

export function observeAuth(callback) {
  onAuthStateChanged(auth, callback);
}

window.observeAuth = observeAuth;

export async function login(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

// ── Firestore CRUD ────────────────────────────────────────────
export async function getProducts() {
  const snapshot = await getDocs(collection(db, "products"));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getOrders() {
  const snapshot = await getDocs(collection(db, "orders"));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addOrder(order) {
  await addDoc(collection(db, "orders"), order);
}

export async function deleteOrder(id) {
  await deleteDoc(doc(db, "orders", id));
}

export async function addProduct(product) {
  await addDoc(collection(db, "products"), product);
}

export async function deleteProduct(id) {
  await deleteDoc(doc(db, "products", id));
}

export async function updateProduct(id, updates) {
  await updateDoc(doc(db, "products", id), updates);
}

// ── Cloudinary image upload ───────────────────────────────────
// Compresses the image client-side before uploading to Cloudinary.
// Returns the secure URL string to store in Firestore.
export async function uploadImage(file) {
  // 1. Compress image to max 800px wide, JPEG 70%
  const compressed = await compressImage(file, 800, 0.7);

  // 2. Upload to Cloudinary via unsigned upload preset
  const formData = new FormData();
  formData.append("file", compressed);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", "dands_products");

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: formData }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || "Error al subir imagen a Cloudinary");
  }

  const data = await res.json();
  return data.secure_url; // Esta URL se guarda en Firestore
}

// Sube varias imágenes en paralelo y devuelve un array de URLs, en el
// mismo orden que se pasaron los archivos.
export async function uploadImages(files) {
  const fileArray = Array.from(files);
  const urls = await Promise.all(fileArray.map(file => uploadImage(file)));
  return urls;
}

// ── Helper: compresión del lado del cliente ───────────────────
function compressImage(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const img    = new Image();

    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width  = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width  = maxWidth;
      }

      canvas.width  = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error("Error al comprimir imagen")),
        "image/jpeg",
        quality
      );
    };

    img.onerror    = () => reject(new Error("Error al cargar la imagen"));
    reader.onload  = e  => { img.src = e.target.result; };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsDataURL(file);
  });
}

// ── Window assignments (compatibilidad con el dashboard) ──────
window.getProducts   = getProducts;
window.getOrders     = getOrders;
window.addOrder      = addOrder;
window.deleteOrder   = deleteOrder;
window.addProduct    = addProduct;
window.deleteProduct = deleteProduct;
window.updateProduct = updateProduct;
window.uploadImage   = uploadImage;
window.uploadImages  = uploadImages;
window.auth          = auth;
window.signInWithEmailAndPassword = signInWithEmailAndPassword;
window.signOut       = signOut;