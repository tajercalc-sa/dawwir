/* =========================================================
   دوّر — رقم عشوائي بين حدّين
   يعتمد على الدوال المشتركة في common.js:
   randomInt, copyText, showToast
   الأجزاء بالترتيب:
   1) الإعدادات  2) عناصر الصفحة  3) قراءة الإعدادات والتحقق منها
   4) توليد الأرقام  5) عرض النتيجة  6) الأحداث والتشغيل
   ========================================================= */

(() => {
  /* ---------- 1) الإعدادات ---------- */

  const LIMIT = 1000000000;   // أكبر حد مسموح (مليار)، عشان العشوائية تبقى دقيقة
  const MAX_COUNT = 1000;     // أقصى عدد أرقام في المرة الوحدة
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 2) عناصر الصفحة ---------- */

  const $ = (id) => document.getElementById(id);
  const form = $("number-form");
  const minInput = $("min-number");
  const maxInput = $("max-number");
  const countInput = $("numbers-count");
  const uniqueInput = $("unique-numbers");
  const uniqueRow = $("unique-row");
  const noticeEl = $("number-notice");
  const genBtn = $("generate-btn");
  const resultEl = $("number-result");
  const outputEl = $("number-output");
  const metaEl = $("number-meta");

  let lastNumbers = null;
  let busy = false;

  /* ---------- 3) قراءة الإعدادات والتحقق منها ---------- */

  // يقبل أرقام صحيحة بس (بدون كسور ولا حروف). يرجّع NaN لو غلط
  function readInt(input) {
    const v = input.value.trim();
    return /^-?\d+$/.test(v) ? Number(v) : NaN;
  }

  function readSettings() {
    const a = readInt(minInput);
    const b = readInt(maxInput);
    const count = readInt(countInput);
    const unique = uniqueInput.checked;

    if (Number.isNaN(a) || Number.isNaN(b)) return { error: "اكتب أرقام صحيحة في الحدّين (بدون كسور)." };
    if (Math.abs(a) > LIMIT || Math.abs(b) > LIMIT) {
      return { error: "الحدود لازم تكون بين سالب مليار ومليار." };
    }
    // لو كتب الأكبر أول، نعكسهم بدل ما نطلع خطأ
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const range = hi - lo + 1;

    if (Number.isNaN(count) || count < 1) return { error: "عدد الأرقام لازم يكون 1 أو أكثر." };
    if (count > MAX_COUNT) return { error: `الحد الأقصى ${MAX_COUNT} رقم في المرة.` };
    if (unique && count > range) {
      return { error: `بين ${lo} و ${hi} فيه ${range} رقم بس، فما تقدر تختار ${count} بدون تكرار.` };
    }
    return { lo, hi, range, count, unique };
  }

  function update() {
    const s = readSettings();
    noticeEl.textContent = s.error || "";
    noticeEl.hidden = !s.error;
    genBtn.disabled = busy || Boolean(s.error);
    // خيار "بدون تكرار" ما له معنى لو رقم واحد
    uniqueRow.hidden = readInt(countInput) === 1;
    genBtn.textContent = readInt(countInput) > 1 ? "اختر الأرقام" : "اختر رقم";
    return s;
  }

  /* ---------- 4) توليد الأرقام ---------- */

  function generate({ lo, hi, range, count, unique }) {
    if (!unique) return Array.from({ length: count }, () => randomInt(lo, hi));

    // بدون تكرار: لو نبغى أغلب الأرقام نخلط القائمة كاملة (Fisher–Yates جزئي)
    if (count * 2 >= range) {
      const all = Array.from({ length: range }, (_, i) => lo + i);
      for (let i = 0; i < count; i++) {
        const j = randomInt(i, range - 1);
        [all[i], all[j]] = [all[j], all[i]];
      }
      return all.slice(0, count);
    }
    // ولو نبغى عدد قليل من مدى كبير: نسحب ونتجاهل المكرر
    const picked = new Set();
    while (picked.size < count) picked.add(randomInt(lo, hi));
    return [...picked];
  }

  /* ---------- 5) عرض النتيجة ---------- */

  function showNumbers(numbers, s) {
    lastNumbers = numbers;
    if (numbers.length === 1) {
      const big = document.createElement("p");
      big.className = "big-number";
      big.textContent = numbers[0];
      outputEl.replaceChildren(big);
    } else {
      const list = document.createElement("ul");
      list.className = "number-chips";
      list.append(
        ...numbers.map((n) => {
          const li = document.createElement("li");
          li.textContent = n;
          return li;
        })
      );
      outputEl.replaceChildren(list);
    }
    const parts = [`بين ${s.lo} و ${s.hi}`];
    if (numbers.length > 1) parts.unshift(`${numbers.length} رقم`, s.unique ? "بدون تكرار" : "مع إمكانية التكرار");
    metaEl.textContent = parts.join(" · ");
    resultEl.hidden = false;
  }

  function run() {
    const s = update();
    if (s.error || busy) return;
    const numbers = generate(s);

    // رقم واحد: نقلّب أرقام سريعة لمدة قصيرة قبل النتيجة
    if (numbers.length === 1 && !reduceMotion) {
      busy = true;
      genBtn.disabled = true;
      const start = performance.now();
      let next = 0;
      const frame = (now) => {
        if (now - start >= 450) {
          busy = false;
          showNumbers(numbers, s);
          update();
          return;
        }
        if (now >= next) {
          showNumbers([randomInt(s.lo, s.hi)], s);
          next = now + 50;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    } else {
      showNumbers(numbers, s);
    }
  }

  /* ---------- 6) الأحداث والتشغيل ---------- */

  // الفورم يخلي زر "Go" في كيبورد الجوال يشغّل الأداة
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });
  [minInput, maxInput, countInput].forEach((el) => el.addEventListener("input", update));
  uniqueInput.addEventListener("change", update);

  // نطاقات جاهزة
  document.querySelectorAll("[data-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const [lo, hi] = btn.dataset.range.split("-");
      minInput.value = lo;
      maxInput.value = hi;
      update();
    })
  );

  $("copy-numbers-btn").addEventListener("click", async () => {
    if (!lastNumbers) return;
    const ok = await copyText(lastNumbers.join("، "));
    showToast(ok ? "تم نسخ النتيجة" : "ما قدرنا ننسخ النتيجة");
  });

  update();
})();
