/* =========================================================
   دوّر — اختيار فائز السحب (Giveaway)
   يعتمد على الدوال المشتركة في common.js:
   shuffle, pickRandom, fitText, copyText, showToast
   كل شي يصير داخل المتصفح، وما نرسل أي بيانات لأي مكان.
   الأجزاء بالترتيب:
   1) الإعدادات  2) عناصر الصفحة  3) تنظيف الأسماء
   4) تجهيز قائمة السحب  5) السحب والعرض التشويقي  6) عرض النتيجة
   7) النسخ  8) حفظ كصورة  9) سجل السحوبات  10) الأحداث والتشغيل
   ========================================================= */

(() => {
  /* ---------- 1) الإعدادات ---------- */

  const MAX_WINNERS = 50;
  const MAX_ALTERNATES = 20;
  const HISTORY_KEY = "dawwir:giveaway:history";
  const HISTORY_LIMIT = 20;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // التاريخ بالميلادي وبأرقام إنجليزية عشان يكون واضح للكل
  const dateFormat = new Intl.DateTimeFormat("ar-u-ca-gregory-nu-latn", {
    dateStyle: "long",
    timeStyle: "short",
  });

  /* ---------- 2) عناصر الصفحة ---------- */

  const $ = (id) => document.getElementById(id);
  const participantsEl = $("participants");
  const participantsCount = $("participants-count");
  const winnersInput = $("winners-count");
  const alternatesInput = $("alternates-count");
  const dedupeInput = $("dedupe");
  const excludedEl = $("excluded");
  const summaryEl = $("draw-summary");
  const noticeEl = $("giveaway-notice");
  const drawBtn = $("draw-btn");
  const stageEl = $("draw-stage");
  const stageName = $("stage-name");
  const resultEl = $("result");
  const historyEl = $("history");
  const historyList = $("history-list");
  const historyCount = $("history-count");

  let pool = null;        // آخر قائمة محسوبة للسحب
  let lastDraw = null;    // آخر نتيجة (للنسخ والصورة)
  let drawing = false;

  /* ---------- 3) تنظيف الأسماء ---------- */

  // حروف مخفية تنلصق أحياناً مع اليوزرات المنسوخة من التطبيقات (اتجاه النص ومسافات بعرض صفر)
  const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;

  // الاسم كما يظهر: بدون حروف مخفية ولا مسافات زايدة
  function cleanName(text) {
    return text.replace(INVISIBLE, "").trim().replace(/\s+/g, " ");
  }

  // مفتاح المقارنة: نتجاهل @ في البداية وحالة الحروف الإنجليزية
  // عشان "@Ali" و "ali" يُعتبرون نفس المشارك
  function nameKey(text) {
    return cleanName(text).replace(/^@+/, "").toLowerCase();
  }

  function readLines(textarea) {
    return textarea.value.split(/\r?\n/).map(cleanName).filter(Boolean);
  }

  // يقرأ رقم من حقل، ويضبطه داخل الحدود المسموحة
  function readNumber(input, min, max) {
    const n = parseInt(input.value, 10);
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /* ---------- 4) تجهيز قائمة السحب ---------- */

  // يحسب مين يدخل السحب فعلياً بعد إزالة المكرر والمستبعدين
  function buildPool() {
    const lines = readLines(participantsEl);
    const excludedKeys = new Set(readLines(excludedEl).map(nameKey));
    const seen = new Set();
    const eligible = [];
    let duplicates = 0;
    let excluded = 0;

    for (const name of lines) {
      const key = nameKey(name);
      if (!key) continue;
      if (excludedKeys.has(key)) {
        excluded++;
        continue;
      }
      if (dedupeInput.checked) {
        if (seen.has(key)) {
          duplicates++;
          continue;
        }
        seen.add(key);
      }
      eligible.push(name);
    }

    return {
      total: lines.length,
      eligible,
      duplicates,
      excluded,
      winners: readNumber(winnersInput, 1, MAX_WINNERS),
      alternates: readNumber(alternatesInput, 0, MAX_ALTERNATES),
    };
  }

  // يحدّث سطر الملخص والرسائل وحالة الزر مع كل تعديل
  function update() {
    pool = buildPool();
    const { total, eligible, duplicates, excluded, winners, alternates } = pool;

    participantsCount.textContent = total;

    const details = [];
    if (duplicates) details.push(`انحذف ${duplicates} مكرر`);
    if (excluded) details.push(`استُبعد ${excluded}`);
    summaryEl.textContent = total
      ? `يدخلون السحب: ${eligible.length} مشارك` + (details.length ? ` (${details.join("، ")})` : "")
      : "";

    let message = "";
    if (!total) {
      message = "الصق أسماء المشاركين أو اليوزرات، كل مشارك في سطر.";
    } else if (!eligible.length) {
      message = "ما بقى أي مشارك بعد الاستبعاد.";
    } else if (winners + alternates > eligible.length) {
      message = `عدد الفائزين والاحتياطيين (${winners + alternates}) أكثر من عدد المشاركين (${eligible.length}).`;
    }
    noticeEl.textContent = message;
    noticeEl.hidden = !message;

    drawBtn.disabled = drawing || Boolean(message);
  }

  /* ---------- 5) السحب والعرض التشويقي ---------- */

  function setBusy(busy) {
    drawing = busy;
    [participantsEl, excludedEl, winnersInput, alternatesInput].forEach((el) => (el.readOnly = busy));
    dedupeInput.disabled = busy;
    resultEl.querySelectorAll("button").forEach((b) => (b.disabled = busy));
    drawBtn.textContent = busy ? "جاري السحب…" : "اختر الفائز";
    update();
  }

  function startDraw() {
    update();
    if (drawing || drawBtn.disabled) return;

    // النتيجة تتحدد هنا مرة وحدة: نخلط القائمة بعشوائية آمنة (crypto) ونأخذ من أولها
    const { eligible, winners, alternates, total } = pool;
    const mixed = shuffle(eligible);
    const draw = {
      time: new Date().toISOString(),
      total,
      eligible: eligible.length,
      winners: mixed.slice(0, winners),
      alternates: mixed.slice(winners, winners + alternates),
    };

    setBusy(true);
    resultEl.hidden = true;
    stageEl.hidden = false;
    stageEl.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });

    // تقليب أسماء سريع يبطّأ تدريجياً لمدة 3 ثواني، بعدها تظهر النتيجة
    const duration = reduceMotion ? 400 : 3000;
    const start = performance.now();
    let nextChange = 0;

    function frame(now) {
      const t = (now - start) / duration;
      if (t >= 1) {
        stageEl.hidden = true;
        setBusy(false);
        showResult(draw);
        saveToHistory(draw);
        return;
      }
      if (now >= nextChange) {
        stageName.textContent = pickRandom(eligible);
        nextChange = now + 50 + 250 * t * t; // الفترة بين الأسماء تطول مع الوقت
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 6) عرض النتيجة ---------- */

  // يبني قائمة مرقّمة. bdi تخلي اليوزرات الإنجليزية تظهر بشكل صحيح داخل صفحة عربية
  function fillRankList(listEl, names) {
    listEl.replaceChildren(
      ...names.map((name, i) => {
        const li = document.createElement("li");
        const rank = document.createElement("span");
        rank.className = "rank";
        rank.textContent = i + 1;
        const bdi = document.createElement("bdi");
        bdi.textContent = name;
        li.append(rank, bdi);
        return li;
      })
    );
  }

  function showResult(draw) {
    lastDraw = draw;
    $("result-title").textContent = draw.winners.length > 1 ? "🎉 الفائزين" : "🎉 الفائز";
    fillRankList($("winners-list"), draw.winners);

    $("alternates-block").hidden = !draw.alternates.length;
    fillRankList($("alternates-list"), draw.alternates);

    $("meta-time").textContent = dateFormat.format(new Date(draw.time));
    $("meta-total").textContent =
      draw.total === draw.eligible ? `${draw.eligible}` : `${draw.eligible} (من ${draw.total} سطر)`;

    resultEl.hidden = false;
    resultEl.focus({ preventScroll: true });
    resultEl.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  /* ---------- 7) النسخ ---------- */

  function resultAsText(draw) {
    const lines = ["🎉 نتيجة السحب", ""];
    lines.push(draw.winners.length > 1 ? "الفائزين:" : "الفائز:");
    draw.winners.forEach((n, i) => lines.push(`${i + 1}. ${n}`));
    if (draw.alternates.length) {
      lines.push("", "الاحتياطيين:");
      draw.alternates.forEach((n, i) => lines.push(`${i + 1}. ${n}`));
    }
    lines.push(
      "",
      `عدد المشاركين: ${draw.eligible}`,
      `وقت السحب: ${dateFormat.format(new Date(draw.time))}`,
      "تم الاختيار عشوائياً عبر dawwir.net"
    );
    return lines.join("\n");
  }

  async function copyResult() {
    if (!lastDraw) return;
    const ok = await copyText(resultAsText(lastDraw));
    showToast(ok ? "تم نسخ النتيجة" : "ما قدرنا ننسخ النتيجة");
  }

  /* ---------- 8) حفظ كصورة (Canvas) ---------- */

  // ألوان الصورة ثابتة (فاتحة) عشان تطلع نفس الشكل مهما كان وضع الجهاز
  const IMG = {
    width: 1080,
    pad: 90,
    bg: "#faf8f3",
    card: "#ffffff",
    primary: "#0e7c66",
    secondary: "#f2a900",
    text: "#1c2321",
    muted: "#5b6662",
    font: 'Cairo, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif',
  };

  // لو أول حرف واضح في الاسم إنجليزي، نكتبه من اليسار لليمين
  const isLtr = (text) => /^[^֐-ࣿ]*[A-Za-z]/.test(text);

  // يصغّر الخط لين يدخل النص في العرض المتاح، ولو ما دخل يقصه بـ "…"
  function setFittedFont(c, text, weight, size, minSize, maxWidth) {
    let s = size;
    c.font = `${weight} ${s}px ${IMG.font}`;
    while (s > minSize && c.measureText(text).width > maxWidth) {
      s -= 4;
      c.font = `${weight} ${s}px ${IMG.font}`;
    }
    return fitText(c, text, maxWidth);
  }

  function drawImage(draw) {
    const { width, pad } = IMG;
    const single = draw.winners.length === 1;
    const rowW = single ? 0 : 88;   // ارتفاع سطر الفائز
    const rowA = 64;                // ارتفاع سطر الاحتياطي

    // نحسب الارتفاع أول، وأقل شي مربع 1080×1080
    let contentH = 120 + 70;                                       // العنوان + المسافة
    contentH += single ? 200 : draw.winners.length * rowW;          // الفائزين
    if (draw.alternates.length) contentH += 90 + draw.alternates.length * rowA;
    contentH += 60 + 2 * 54 + 50 + 60;                              // التفاصيل والتذييل
    const height = Math.max(width, contentH + pad * 2);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d");
    c.textBaseline = "middle";

    // الخلفية والبطاقة
    c.fillStyle = IMG.bg;
    c.fillRect(0, 0, width, height);
    const cardX = 40, cardY = 40, cardW = width - 80, cardH = height - 80;
    c.fillStyle = IMG.card;
    c.beginPath();
    if (c.roundRect) c.roundRect(cardX, cardY, cardW, cardH, 36);
    else c.rect(cardX, cardY, cardW, cardH);
    c.fill();
    c.fillStyle = IMG.secondary;
    c.fillRect(cardX + 36, cardY, cardW - 72, 10); // شريط ذهبي فوق

    let y = (height - contentH) / 2 + 60;
    const center = width / 2;
    const maxW = width - pad * 2 - 40;

    // العنوان
    c.direction = "rtl";
    c.textAlign = "center";
    c.fillStyle = IMG.primary;
    c.font = `900 72px ${IMG.font}`;
    c.fillText(single ? "🎉 الفائز" : "🎉 الفائزين", center, y);
    y += 120 + 30;

    // الفائزين
    if (single) {
      const name = draw.winners[0];
      c.direction = isLtr(name) ? "ltr" : "rtl";
      c.fillStyle = IMG.text;
      c.fillText(setFittedFont(c, name, 900, 110, 48, maxW), center, y + 70);
      y += 200;
    } else {
      draw.winners.forEach((name, i) => drawRankRow(c, i + 1, name, y + i * rowW + rowW / 2, 56, IMG.secondary, IMG.text));
      y += draw.winners.length * rowW;
    }

    // الاحتياطيين
    if (draw.alternates.length) {
      y += 40;
      c.direction = "rtl";
      c.textAlign = "center";
      c.fillStyle = IMG.muted;
      c.font = `700 44px ${IMG.font}`;
      c.fillText("الاحتياطيين", center, y + 20);
      y += 50;
      draw.alternates.forEach((name, i) => drawRankRow(c, i + 1, name, y + i * rowA + rowA / 2, 40, "#e8e4da", IMG.text));
      y += draw.alternates.length * rowA;
    }

    // التفاصيل
    y += 60;
    c.direction = "rtl";
    c.textAlign = "center";
    c.fillStyle = IMG.muted;
    c.font = `600 36px ${IMG.font}`;
    c.fillText(`عدد المشاركين: ${draw.eligible}`, center, y);
    y += 54;
    c.fillText(`وقت السحب: ${dateFormat.format(new Date(draw.time))}`, center, y);
    y += 54 + 50;

    // التذييل
    c.fillStyle = IMG.primary;
    c.font = `700 36px ${IMG.font}`;
    c.fillText("اختيار عشوائي عبر dawwir.net", center, y);

    return canvas;

    // سطر مرقّم: دائرة الرقم يمين، والاسم بجانبها
    function drawRankRow(c, rank, name, cy, size, badgeColor, textColor) {
      const right = width - pad - 20;
      const r = size * 0.62;
      c.beginPath();
      c.arc(right - r, cy, r, 0, Math.PI * 2);
      c.fillStyle = badgeColor;
      c.fill();
      c.direction = "ltr";
      c.textAlign = "center";
      c.fillStyle = IMG.text;
      c.font = `800 ${Math.round(size * 0.7)}px ${IMG.font}`;
      c.fillText(String(rank), right - r, cy + 2);

      const textRight = right - r * 2 - 24;
      c.direction = isLtr(name) ? "ltr" : "rtl";
      c.textAlign = "right";
      c.fillStyle = textColor;
      c.fillText(setFittedFont(c, name, 700, size, 28, textRight - pad - 20), textRight, cy);
    }
  }

  async function saveImage() {
    if (!lastDraw) return;
    // نتأكد إن خط Cairo جاهز قبل الرسم
    if (document.fonts) await document.fonts.load(`900 72px Cairo`);
    const canvas = drawImage(lastDraw);
    canvas.toBlob(async (blob) => {
      if (!blob) return showToast("ما قدرنا نجهز الصورة");
      const fileName = `dawwir-giveaway-${Date.now()}.png`;

      // على الجوال: قائمة المشاركة تسمح بحفظ الصورة أو نشرها مباشرة
      const file = new File([blob], fileName, { type: "image/png" });
      const isTouch = window.matchMedia("(pointer: coarse)").matches;
      if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "نتيجة السحب" });
          return;
        } catch (e) {
          if (e.name === "AbortError") return;
        }
      }

      // على الكمبيوتر: تحميل مباشر
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("تم حفظ الصورة");
    }, "image/png");
  }

  /* ---------- 9) سجل السحوبات (محفوظ في جهازك بس) ---------- */

  function loadHistory() {
    try {
      const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function saveToHistory(draw) {
    const history = [draw, ...loadHistory()].slice(0, HISTORY_LIMIT);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      // نتجاهل: السجل اختياري
    }
    renderHistory(history);
  }

  function renderHistory(history = loadHistory()) {
    historyEl.hidden = !history.length;
    historyCount.textContent = history.length;
    historyList.replaceChildren(
      ...history.map((d) => {
        const li = document.createElement("li");
        const time = document.createElement("span");
        time.className = "history-time";
        time.textContent = `${dateFormat.format(new Date(d.time))} · ${d.eligible} مشارك`;
        const names = document.createElement("bdi");
        names.textContent = `${d.winners.length > 1 ? "الفائزين" : "الفائز"}: ${d.winners.join("، ")}`;
        li.append(time, names);
        return li;
      })
    );
  }

  /* ---------- 10) الأحداث والتشغيل ---------- */

  [participantsEl, excludedEl, winnersInput, alternatesInput].forEach((el) => el.addEventListener("input", update));
  dedupeInput.addEventListener("change", update);

  // لما يطلع من حقل الرقم نصحّح القيمة لو كانت برا الحدود
  winnersInput.addEventListener("change", () => (winnersInput.value = readNumber(winnersInput, 1, MAX_WINNERS)));
  alternatesInput.addEventListener("change", () => (alternatesInput.value = readNumber(alternatesInput, 0, MAX_ALTERNATES)));

  drawBtn.addEventListener("click", startDraw);
  $("redraw-btn").addEventListener("click", startDraw);
  $("copy-result-btn").addEventListener("click", copyResult);
  $("save-image-btn").addEventListener("click", saveImage);
  $("clear-history-btn").addEventListener("click", () => {
    if (!confirm("تمسح سجل السحوبات؟")) return;
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch (e) {
      // نتجاهل
    }
    renderHistory([]);
  });

  update();
  renderHistory();
})();
