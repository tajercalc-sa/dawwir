/* =========================================================
   دوّر — دوال مشتركة تستخدمها كل الأدوات
   يُحمَّل بـ defer في كل صفحة، قبل ملف الأداة الخاص
   ========================================================= */

/* ---------- 1) العشوائية ---------- */
// نستخدم crypto.getRandomValues بدل Math.random لأنها أعدل وأصعب في التوقع،
// وهذا مهم في أدوات السحب واختيار الفائز

// رقم عشوائي صحيح بين min و max (يشمل الطرفين)
function randomInt(min, max) {
  const range = max - min + 1;
  // نرفض القيم اللي تسبب انحياز (rejection sampling) عشان كل رقم له نفس الفرصة
  const limit = Math.floor(0x100000000 / range) * range;
  const buffer = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return min + (value % range);
}

// يختار عنصر واحد عشوائي من مصفوفة
function pickRandom(array) {
  return array[randomInt(0, array.length - 1)];
}

// يخلط نسخة من المصفوفة (خوارزمية Fisher–Yates) بدون ما يغيّر الأصلية
function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/* ---------- 2) أدوات النصوص ---------- */

// يحوّل نص فيه أسماء (كل اسم في سطر) إلى مصفوفة نظيفة بدون أسطر فاضية
// الفاصلة ما نعتبرها فاصل عشان خيارات مثل "1,000" تبقى كما هي
function parseNames(text) {
  return text
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

// يحوّل الأرقام الإنجليزية إلى أرقام عربية (١٢٣) عند الحاجة
function toArabicDigits(value) {
  return String(value).replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
}

// يقسم النص لحروف مرئية، عشان لما نقص النص ما ينقطع إيموجي من النص
const graphemeSegmenter =
  window.Intl && Intl.Segmenter ? new Intl.Segmenter("ar", { granularity: "grapheme" }) : null;
function graphemes(text) {
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), (s) => s.segment)
    : Array.from(text);
}

// يقص النص ويضيف "…" لو أعرض من المساحة المتاحة في الـ canvas
// c: سياق الرسم (ctx) بعد ما نحدد الخط، maxWidth: أقصى عرض بالبكسل
function fitText(c, text, maxWidth) {
  if (c.measureText(text).width <= maxWidth) return text;
  const parts = graphemes(text);
  let low = 0;
  let high = parts.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (c.measureText(parts.slice(0, mid).join("") + "…").width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return parts.slice(0, low).join("") + "…";
}

/* ---------- 3) النسخ والرسائل ---------- */

// ينسخ نص للحافظة. يرجّع true لو نجح
// navigator.clipboard يشتغل بس على https، فعندنا طريقة احتياطية للتجربة المحلية على http
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    // نكمل للطريقة الاحتياطية
  }
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (e) {
    ok = false;
  }
  helper.remove();
  return ok;
}

// رسالة صغيرة تظهر تحت الشاشة لثواني ثم تختفي (toast)
let toastTimer;
function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

/* ---------- 4) تجهيز الصفحة ---------- */

document.addEventListener("DOMContentLoaded", () => {
  // نحط سنة اليوم في الـ footer تلقائياً
  const yearEl = document.querySelector("[data-year]");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
