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

/* ---------- 3) الحركة على canvas ---------- */

// دالة تباطؤ مثل cubic-bezier في CSS، للحركات اللي نرسمها بأنفسنا (النرد والعملة)
// ترجّع دالة تاخذ التقدّم في الوقت (0 إلى 1) وترجّع التقدّم في الحركة
// الطريقة: نحل x(t) = الوقت بطريقة Newton ثم نرجّع y(t)
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const curveX = (t) => ((ax * t + bx) * t + cx) * t;
  const curveY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = curveX(t) - x;
      const s = slopeX(t);
      if (Math.abs(err) < 1e-6 || Math.abs(s) < 1e-6) break;
      t -= err / s;
    }
    // احتياط: لو Newton طلع برّا المدى نستخدم التنصيف
    if (t < 0 || t > 1 || Math.abs(curveX(t) - x) > 1e-4) {
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        if (curveX(t) < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return curveY(t);
  };
}

/* ---------- 4) النسخ والرسائل ---------- */

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

// من هذا العرض وفوق نعتبر الشاشة كمبيوتر (لازم يطابق قسم 900px في style.css)
const DESKTOP_QUERY = window.matchMedia("(min-width: 900px)");

/* ---------- 5) قائمة الأدوات على الجوال ---------- */
// زر «الأدوات» يفتح ويقفل لوحة الروابط تحت الهيدر.
// تتقفل بالضغط على الزر مرة ثانية، أو بالضغط خارجها، أو بزر Escape، أو لما يطلع التركيز منها
function initNavMenu() {
  const header = document.querySelector(".site-header");
  const toggle = header && header.querySelector(".nav-toggle");
  const nav = header && header.querySelector(".site-nav");
  if (!toggle || !nav) return;

  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";
  function setOpen(open) {
    toggle.setAttribute("aria-expanded", String(open));
    header.classList.toggle("nav-open", open);
  }

  toggle.addEventListener("click", () => setOpen(!isOpen()));

  // الضغط في أي مكان خارج اللوحة والزر يقفلها
  document.addEventListener("click", (e) => {
    if (isOpen() && !nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });

  // Escape يقفلها ويرجع التركيز للزر عشان مستخدم الكيبورد ما يضيع مكانه
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });

  // لو انتقل التركيز بـ Tab لعنصر خارج الهيدر، نقفل اللوحة
  header.addEventListener("focusout", (e) => {
    if (isOpen() && e.relatedTarget && !header.contains(e.relatedTarget)) setOpen(false);
  });

  // لو كبرت الشاشة للكمبيوتر واللوحة مفتوحة، نقفلها عشان ما ترجع مفتوحة لما تصغر
  DESKTOP_QUERY.addEventListener("change", (e) => {
    if (e.matches) setOpen(false);
  });
}

/* ---------- 6) نمو مربعات النص تلقائياً على الجوال ---------- */
// المربع يكبر مع عدد الأسطر ويصغر لما تقل، بين min-height و max-height المكتوبين في style.css.
// على الكمبيوتر نرجّعه لارتفاعه العادي (المستخدم يكبّره بالسحب)
function autoGrow(textarea) {
  if (DESKTOP_QUERY.matches) {
    textarea.style.height = "";
    textarea.style.overflowY = "";
    return;
  }
  // المربع المخفي (مثلاً داخل <details> مقفل) ما له مقاس، نحسبه لما ينفتح
  if (!textarea.getClientRects().length) return;

  // نحفظ مكان التمرير، لأن تصغير المربع لحظياً ممكن يحرّك الصفحة
  const scrollY = window.scrollY;
  // نصغّره لأقل شي (الـ CSS يمنعه ينزل تحت min-height)، عشان scrollHeight يعطينا طول المحتوى الحقيقي
  textarea.style.height = "0px";
  const styles = getComputedStyle(textarea);
  const borders = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
  const needed = textarea.scrollHeight + borders;
  const max = parseFloat(styles.maxHeight);
  textarea.style.height = `${needed}px`; // الـ CSS يوقفه عند max-height
  // التمرير الداخلي يظهر بس لما المحتوى أطول من الحد الأقصى
  textarea.style.overflowY = needed > max ? "auto" : "hidden";
  if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
}

function initAutoGrow() {
  const areas = document.querySelectorAll("textarea");
  if (!areas.length) return;
  const growAll = () => areas.forEach(autoGrow);

  areas.forEach((textarea) => textarea.addEventListener("input", () => autoGrow(textarea)));
  // مربع داخل <details> نحسبه لما ينفتح
  document.querySelectorAll("details").forEach((d) => d.addEventListener("toggle", growAll));
  // تغيّر العرض يغيّر التفاف الأسطر الطويلة، والتحويل بين جوال وكمبيوتر يغيّر القواعد
  let frame;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(growAll);
  });
  DESKTOP_QUERY.addEventListener("change", growAll);
  // زر الرجوع في المتصفح ممكن يرجّع نص قديم بدون حدث input
  window.addEventListener("pageshow", growAll);
  // بعد تحميل الخط يتغير عرض الحروف، فممكن يتغير التفاف الأسطر
  if (document.fonts) document.fonts.ready.then(growAll);
  growAll();
}

/* ---------- 7) تجهيز الصفحة ---------- */

document.addEventListener("DOMContentLoaded", () => {
  // نحط سنة اليوم في الـ footer تلقائياً
  const yearEl = document.querySelector("[data-year]");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  initNavMenu();
  initAutoGrow();
});
