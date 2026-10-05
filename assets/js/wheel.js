/* =========================================================
   دوّر — محرك العجلة (عجلة الأسماء + كل العجلات الجاهزة)
   كل صفحة عجلة تستخدم هذا الملف نفسه، والفرق بينها يجي من الـ HTML:
   - القائمة الافتراضية: مكتوبة داخل <textarea id="options"> في الصفحة
   - data-storage-key على <section id="tool">: مفتاح حفظ خاص بكل عجلة
   - data-share-title على <section id="tool">: السؤال اللي يظهر في نص المشاركة
   يعتمد على الدوال المشتركة في common.js:
   randomInt, parseNames, fitText, copyText, showToast
   الأجزاء بالترتيب:
   1) الإعدادات  2) عناصر الصفحة والحالة  3) الحفظ والمشاركة
   4) الصوت  5) رسم العجلة  6) الدوران  7) نافذة النتيجة
   8) الأزرار والقوائم الجاهزة  9) التشغيل
   ========================================================= */

(() => {
  /* ---------- 1) الإعدادات ---------- */

  const MAX_OPTIONS = 100;
  const toolEl = document.getElementById("tool");
  const STORAGE_KEY = toolEl.dataset.storageKey || "dawwir:wheel:list";
  const SHARE_TITLE = toolEl.dataset.shareTitle || "عجلة دوّر";
  const MUTE_KEY = "dawwir:muted";
  const TWO_PI = Math.PI * 2;

  // ألوان القطع: متناسقة مع اللون الأساسي والثانوي للموقع
  const SLICE_COLORS = [
    "#0e7c66", "#f2a900", "#2f6fb0", "#e76f51",
    "#264653", "#e9c46a", "#8e5ba8", "#4caf8e",
  ];

  // الخط في العجلة: Cairo للعربي، وخطوط الإيموجي عشان تظهر ملوّنة
  const WHEEL_FONT =
    'Cairo, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif';

  // القوائم الجاهزة (أزرار data-preset في عجلة الأسماء)
  const PRESETS = {
    numbers: Array.from({ length: 10 }, (_, i) => String(i + 1)),
    yesno: ["نعم", "لا"],
    colors: ["أحمر", "أزرق", "أخضر", "أصفر", "برتقالي", "بنفسجي", "وردي", "أسود"],
    days: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
    food: ["كبسة", "مندي", "شاورما", "برغر", "بيتزا", "مشاوي"],
  };
  // لو الصفحة فيها قائمة مكتوبة داخل مربع النص نعتبرها الافتراضية، وإلا نستخدم قائمة الأكل
  const textareaDefault = parseNames(document.getElementById("options").defaultValue);
  const DEFAULT_LIST = textareaDefault.length ? textareaDefault : PRESETS.food;

  /* ---------- 2) عناصر الصفحة والحالة ---------- */

  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const wrap = document.querySelector(".wheel-wrap");
  const textarea = document.getElementById("options");
  const countEl = document.getElementById("options-count");
  const noticeEl = document.getElementById("wheel-notice");
  const spinBtn = document.getElementById("spin-btn");
  const muteBtn = document.getElementById("mute-btn");
  const shareBtn = document.getElementById("share-btn");
  const clearBtn = document.getElementById("clear-btn");
  const presetBtns = document.querySelectorAll("[data-preset]");
  const resetBtn = document.getElementById("reset-list-btn"); // موجود في العجلات الجاهزة بس
  const dialog = document.getElementById("result-dialog");
  const resultName = document.getElementById("result-name");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let items = [];          // الخيارات الظاهرة في العجلة (أول 100 بس)
  let rotation = 0;        // زاوية دوران العجلة بالراديان (مع عقارب الساعة)
  let spinning = false;
  let lastWinner = -1;     // رقم الفائز الأخير في مصفوفة items
  let size = 0;            // عرض العجلة بالـ CSS pixels
  let dpr = 1;             // كثافة بكسلات الشاشة (لشاشات الجوال الحادة)
  let wheelImage = null;   // صورة العجلة مرسومة مسبقاً، ندوّرها بدل ما نعيد رسم كل القطع كل frame

  // باقي القسمة الموجب (لأن % في JavaScript ممكن يرجّع سالب)
  const mod = (n, m) => ((n % m) + m) % m;

  /* ---------- 3) الحفظ والمشاركة ---------- */

  // localStorage ممكن يكون مقفول (مثلاً وضع التصفح الخفي)، فنلفه بـ try/catch
  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // نتجاهل: الأداة تشتغل بدون حفظ
    }
  }

  // تحويل القائمة لنص قصير يصلح للرابط (UTF-8 ← base64url)
  // أقصر من ترميز الحروف العربية العادي في الرابط بأكثر من النص
  function encodeList(list) {
    const bytes = new TextEncoder().encode(list.join("\n"));
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // العكس: من الرابط إلى قائمة. يرجّع null لو الرابط خربان
  function decodeList(code) {
    try {
      let b64 = code.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const list = parseNames(new TextDecoder().decode(bytes));
      return list.length ? list.slice(0, MAX_OPTIONS) : null;
    } catch (e) {
      return null;
    }
  }

  function buildShareUrl() {
    const base = location.href.split(/[?#]/)[0];
    return base + "?l=" + encodeList(items);
  }

  /* ---------- 4) الصوت (Web Audio API بدون ملفات) ---------- */

  const sound = {
    ctx: null,
    muted: storageGet(MUTE_KEY) === "1",
    lastTick: 0,

    // المتصفح ما يسمح بالصوت إلا بعد ضغطة من المستخدم، فنجهّزه عند ضغط "دوّر"
    unlock() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },

    // نغمة قصيرة: تردد، مدة، نوع الموجة، وقت البداية، ارتفاع الصوت
    tone(freq, duration, type, delay = 0, volume = 0.15) {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    },

    // "تك" كل ما تعدّي قطعة تحت المؤشر (بحد أقصى صوت كل 45ms عشان ما يزعج)
    tick() {
      const now = performance.now();
      if (now - this.lastTick < 45) return;
      this.lastTick = now;
      this.tone(1100, 0.04, "triangle", 0, 0.08);
    },

    // نغمة فوز: ثلاث نوتات صاعدة
    win() {
      [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.35, "sine", i * 0.11, 0.18));
    },
  };

  function updateMuteButton() {
    muteBtn.textContent = sound.muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(sound.muted));
    muteBtn.setAttribute("aria-label", sound.muted ? "تشغيل الصوت" : "كتم الصوت");
  }

  /* ---------- 5) رسم العجلة ---------- */

  // يقرأ لون من متغيرات CSS (عشان يتبع الوضع الفاتح/الداكن)
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // لون النص المناسب (أبيض أو غامق): نحسب التباين الحقيقي (معيار WCAG) ونختار الأوضح
  function textColorFor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const channel = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lum = 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
    const darkLum = 0.0154; // لوميننس اللون الغامق #1c2321
    const withWhite = 1.05 / (lum + 0.05);
    const withDark = (lum + 0.05) / (darkLum + 0.05);
    return withDark > withWhite ? "#1c2321" : "#ffffff";
  }

  // لون القطعة رقم i، مع التأكد إن آخر قطعة ما تشبه الأولى (لأنهم جيران)
  function sliceColor(i, n) {
    let index = i % SLICE_COLORS.length;
    if (n > 1 && i === n - 1 && index === 0) index = 1;
    return SLICE_COLORS[index];
  }

  // يرسم العجلة كاملة (بدون دوران) في canvas مخفي مرة وحدة لما تتغير الخيارات أو المقاس
  function renderWheel() {
    if (!size) return;
    const off = document.createElement("canvas");
    off.width = off.height = Math.round(size * dpr);
    const c = off.getContext("2d");
    c.scale(dpr, dpr);

    const center = size / 2;
    const radius = center - 4;
    const hubRadius = Math.max(14, radius * 0.11);
    const surface = cssVar("--color-surface") || "#ffffff";
    const n = items.length;

    if (n === 0) {
      // عجلة فاضية: دائرة رمادية مع تلميح
      c.beginPath();
      c.arc(center, center, radius, 0, TWO_PI);
      c.fillStyle = cssVar("--color-border") || "#ddd";
      c.fill();
      c.fillStyle = cssVar("--color-muted") || "#666";
      c.font = `700 ${Math.round(radius * 0.12)}px ${WHEEL_FONT}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.direction = "rtl";
      c.fillText("اكتب خياراتك", center, center + radius * 0.35);
    } else {
      const angle = TWO_PI / n;
      // حجم الخط: حسب عرض القطعة، وبحد أقصى معقول
      const fontSize = Math.min(radius * 0.1, ((TWO_PI * radius * 0.62) / n) * 0.62);
      const showText = fontSize >= 7; // مع 100 خيار القطع ضيقة جداً، فنخفي النص بدل ما يتداخل
      const textStart = radius - 14;                     // النص يبدأ قرب الحافة
      const maxTextWidth = textStart - hubRadius - 10;   // وينتهي قبل الدائرة اللي بالوسط

      for (let i = 0; i < n; i++) {
        // القطعة الأولى تبدأ من فوق (عند المؤشر) وتمشي مع عقارب الساعة
        const start = -Math.PI / 2 + i * angle;
        const color = sliceColor(i, n);

        c.beginPath();
        c.moveTo(center, center);
        c.arc(center, center, radius, start, start + angle);
        c.closePath();
        c.fillStyle = color;
        c.fill();
        if (n > 1) {
          c.strokeStyle = "rgba(255, 255, 255, 0.55)";
          c.lineWidth = n > 40 ? 0.5 : 1.5;
          c.stroke();
        }

        if (showText) {
          // ندوّر الـ canvas لمنتصف القطعة ونكتب النص على طول نصف القطر
          c.save();
          c.translate(center, center);
          c.rotate(start + angle / 2);
          c.font = `700 ${fontSize}px ${WHEEL_FONT}`;
          c.direction = "rtl";
          c.textAlign = "right";
          c.textBaseline = "middle";
          c.fillStyle = textColorFor(color);
          c.fillText(fitText(c, items[i], maxTextWidth), textStart, 0);
          c.restore();
        }
      }
    }

    // الإطار الخارجي والدائرة اللي بالوسط
    c.beginPath();
    c.arc(center, center, radius, 0, TWO_PI);
    c.lineWidth = 4;
    c.strokeStyle = surface;
    c.stroke();

    c.beginPath();
    c.arc(center, center, hubRadius, 0, TWO_PI);
    c.fillStyle = surface;
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = cssVar("--color-primary") || "#0e7c66";
    c.stroke();

    wheelImage = off;
  }

  // يرسم الصورة الجاهزة مع زاوية الدوران الحالية (هذا اللي يتكرر أثناء الدوران)
  function draw() {
    const w = canvas.width;
    ctx.clearRect(0, 0, w, w);
    if (!wheelImage) return;
    ctx.save();
    ctx.translate(w / 2, w / 2);
    ctx.rotate(rotation);
    ctx.drawImage(wheelImage, -w / 2, -w / 2, w, w);
    ctx.restore();
  }

  // يضبط مقاس الـ canvas حسب عرض الشاشة
  function resize() {
    const newSize = wrap.clientWidth;
    const newDpr = Math.min(window.devicePixelRatio || 1, 3);
    if (newSize === size && newDpr === dpr) return;
    size = newSize;
    dpr = newDpr;
    canvas.width = canvas.height = Math.round(size * dpr);
    renderWheel();
    draw();
  }

  /* ---------- 6) الدوران ---------- */

  // رقم القطعة اللي تحت المؤشر (فوق) عند زاوية معينة
  function indexAt(rot) {
    const n = items.length;
    return Math.floor(mod(-rot, TWO_PI) / (TWO_PI / n)) % n;
  }

  function spin() {
    if (spinning || items.length < 2) return;
    sound.unlock();
    setBusy(true);

    const n = items.length;
    const angle = TWO_PI / n;

    // 1) نختار الفائز أول بعشوائية عادلة (crypto)، كل خيار له نفس الفرصة
    const winner = randomInt(0, n - 1);
    // 2) نقطة عشوائية داخل قطعة الفائز (بعيد عن الحواف عشان يبان واضح)
    const offset = angle * (0.1 + 0.8 * (randomInt(0, 1000) / 1000));
    // 3) نحسب كم لازم ندوّر عشان هذي النقطة توقف تحت المؤشر، ونضيف 5 إلى 7 لفات كاملة
    const target = mod(-(winner * angle + offset), TWO_PI);
    const delta = mod(target - mod(rotation, TWO_PI), TWO_PI);
    const total = randomInt(5, 7) * TWO_PI + delta;

    const startRotation = rotation;
    const duration = reduceMotion ? 1200 : 4500 + randomInt(0, 1000);
    const startTime = performance.now();
    let lastIndex = indexAt(rotation);

    function frame(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 4); // تبطئة تدريجية (easeOutQuart)
      rotation = startRotation + total * eased;
      draw();

      const current = indexAt(rotation);
      if (current !== lastIndex) {
        lastIndex = current;
        sound.tick();
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        rotation = mod(rotation, TWO_PI); // نرجّع الزاوية لرقم صغير
        setBusy(false);
        sound.win();
        showResult(indexAt(rotation));
      }
    }
    requestAnimationFrame(frame);
  }

  // يقفل التعديل أثناء الدوران عشان القائمة ما تتغير والعجلة تلف
  function setBusy(busy) {
    spinning = busy;
    textarea.readOnly = busy;
    clearBtn.disabled = busy;
    presetBtns.forEach((b) => (b.disabled = busy));
    if (resetBtn) resetBtn.disabled = busy;
    spinBtn.textContent = busy ? "تدوّر…" : "دوّر";
    updateSpinButton();
  }

  function updateSpinButton() {
    spinBtn.disabled = spinning || items.length < 2;
  }

  /* ---------- 7) نافذة النتيجة ---------- */

  function showResult(index) {
    lastWinner = index;
    resultName.textContent = items[index];
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeResult() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  // يحذف الفائز من مربع النص (السطر نفسه، حتى لو فيه أسماء مكررة)
  function removeWinner() {
    if (lastWinner < 0) return;
    const name = items[lastWinner];
    const lines = textarea.value.split(/\r?\n/);
    let count = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim()) count++;
      if (count === lastWinner) {
        lines.splice(i, 1);
        break;
      }
    }
    textarea.value = lines.join("\n");
    lastWinner = -1;
    onUserEdit();
    closeResult();
    showToast(`انحذف «${name}» من القائمة`);
  }

  /* ---------- 8) تحديث القائمة والأزرار ---------- */

  // يقرأ مربع النص ويحدّث العجلة والعداد والرسائل
  function updateFromText() {
    const all = parseNames(textarea.value);
    items = all.slice(0, MAX_OPTIONS);

    countEl.textContent = `${all.length} / ${MAX_OPTIONS}`;
    countEl.classList.toggle("over", all.length > MAX_OPTIONS);

    let message = "";
    if (all.length > MAX_OPTIONS) {
      message = `الحد الأقصى ${MAX_OPTIONS} خيار. أول ${MAX_OPTIONS} بس تظهر في العجلة، والباقي (${all.length - MAX_OPTIONS}) ما راح يدخل السحب.`;
    } else if (items.length === 0) {
      message = resetBtn
        ? "اكتب خيار في كل سطر، أو رجّع القائمة الأصلية من تحت."
        : "اكتب خيار في كل سطر، أو اختر قائمة جاهزة من تحت.";
    } else if (items.length === 1) {
      message = "أضف خيار ثاني على الأقل عشان تقدر تدوّر.";
    }
    noticeEl.textContent = message;
    noticeEl.hidden = !message;

    canvas.setAttribute("aria-label", `عجلة فيها ${items.length} خيار`);
    updateSpinButton();
    renderWheel();
    draw();
  }

  // كل تعديل من المستخدم: نحفظ، ونشيل القائمة المشتركة من الرابط (عشان التحديث ما يرجّعها)
  function onUserEdit() {
    storageSet(STORAGE_KEY, textarea.value);
    if (new URLSearchParams(location.search).has("l")) {
      history.replaceState(null, "", location.pathname + location.hash);
    }
    updateFromText();
  }

  function isPreset(list) {
    return Object.values(PRESETS).some((p) => p.join("\n") === list.join("\n"));
  }

  textarea.addEventListener("input", onUserEdit);

  spinBtn.addEventListener("click", spin);
  canvas.addEventListener("click", spin);

  muteBtn.addEventListener("click", () => {
    sound.muted = !sound.muted;
    storageSet(MUTE_KEY, sound.muted ? "1" : "0");
    updateMuteButton();
  });

  clearBtn.addEventListener("click", () => {
    if (!textarea.value.trim()) return;
    if (!confirm("تمسح كل الخيارات؟")) return;
    textarea.value = "";
    onUserEdit();
    textarea.focus();
  });

  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = PRESETS[btn.dataset.preset];
      const current = parseNames(textarea.value);
      // نسأل قبل ما نستبدل قائمة كتبها المستخدم بنفسه
      if (current.length && !isPreset(current) && !confirm("تستبدل قائمتك الحالية بالقائمة الجاهزة؟")) return;
      textarea.value = list.join("\n");
      onUserEdit();
    });
  });

  // يرجّع القائمة الجاهزة الأصلية للصفحة (بعد ما عدّلها المستخدم)
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const current = parseNames(textarea.value);
      if (current.join("\n") === DEFAULT_LIST.join("\n")) return;
      if (current.length && !confirm("ترجّع القائمة الأصلية وتمسح تعديلاتك؟")) return;
      textarea.value = DEFAULT_LIST.join("\n");
      onUserEdit();
    });
  }

  shareBtn.addEventListener("click", async () => {
    if (!items.length) {
      showToast("اكتب خيارات أول عشان تشاركها");
      return;
    }
    const url = buildShareUrl();
    // على الجوال (https) تطلع قائمة المشاركة حقت النظام (واتساب وغيره)
    if (navigator.share) {
      try {
        await navigator.share({ title: "عجلة دوّر", text: "دوّر العجلة على هذي الخيارات:", url });
        return;
      } catch (e) {
        if (e.name === "AbortError") return; // المستخدم قفل قائمة المشاركة
      }
    }
    const ok = await copyText(url);
    showToast(ok ? "تم نسخ الرابط، أرسله في الواتساب" : "ما قدرنا ننسخ الرابط");
  });

  // أزرار نافذة النتيجة
  document.getElementById("remove-winner-btn").addEventListener("click", removeWinner);
  document.getElementById("spin-again-btn").addEventListener("click", () => {
    closeResult();
    spin();
  });
  document.getElementById("copy-result-btn").addEventListener("click", async () => {
    const ok = await copyText(`نتيجة عجلة دوّر: ${resultName.textContent}`);
    showToast(ok ? "تم نسخ النتيجة" : "ما قدرنا ننسخ النتيجة");
  });
  // شارك النتيجة: نص قصير جاهز للواتساب، فيه السؤال والنتيجة ورابط الصفحة في الآخر
  document.getElementById("share-result-btn").addEventListener("click", async () => {
    const canonical = document.querySelector('link[rel="canonical"]');
    const pageUrl = canonical ? canonical.href : location.href.split(/[?#]/)[0];
    const text = `🎡 ${SHARE_TITLE}\nالعجلة اختارت: *${resultName.textContent}*\n\nدوّرها أنت: ${pageUrl}`;
    // على الجوال تطلع قائمة المشاركة (واتساب وغيره)، وعلى الكمبيوتر ننسخ النص
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (isTouch && navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
      }
    }
    const ok = await copyText(text);
    showToast(ok ? "تم نسخ النص، الصقه في الواتساب" : "ما قدرنا ننسخ النص");
  });
  document.getElementById("close-result-btn").addEventListener("click", closeResult);
  // الضغط على الخلفية المظلمة يقفل النافذة
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closeResult();
  });

  /* ---------- 9) التشغيل ---------- */

  // الأولوية: رابط مشترك ← قائمة محفوظة ← القائمة الافتراضية
  const shared = new URLSearchParams(location.search).get("l");
  const sharedList = shared ? decodeList(shared) : null;
  const saved = storageGet(STORAGE_KEY);

  if (sharedList) {
    textarea.value = sharedList.join("\n");
    showToast("انفتحت القائمة المشتركة");
  } else if (saved !== null) {
    textarea.value = saved;
  } else {
    textarea.value = DEFAULT_LIST.join("\n");
  }

  updateMuteButton();
  updateFromText();
  resize();

  // العجلة تتجاوب مع تغيّر عرض الشاشة (تدوير الجوال مثلاً)
  if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
  else window.addEventListener("resize", resize);

  // نعيد الرسم لما يخلص تحميل الخط، ولما يتغير الوضع الفاتح/الداكن
  if (document.fonts) {
    document.fonts.load(`700 20px Cairo`).then(() => {
      renderWheel();
      draw();
    });
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    renderWheel();
    draw();
  });
})();
