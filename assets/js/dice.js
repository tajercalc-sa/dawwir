/* =========================================================
   دوّر — رمي النرد
   يعتمد على الدوال المشتركة في common.js: randomInt
   وعلى محرك الـ 3D في dice3d.js لرسم كل الأنواع على canvas (d4, d6, d8, d10, d12, d20)
   الأجزاء بالترتيب:
   1) الإعدادات  2) عناصر الصفحة  3) الصوت  4) رسم النرد  5) الحركة  6) الرمي  7) الأحداث والتشغيل
   ========================================================= */

(() => {
  /* ---------- 1) الإعدادات ---------- */

  const STORAGE_KEY = "dawwir:dice:settings";
  const MUTE_KEY = "dawwir:muted"; // نفس مفتاح كتم الصوت في عجلة الأسماء
  const ROLL_DURATION = 1200; // مدة دوران النرد بالملي ثانية (كل الأنواع)
  const STAGGER = 90; // تأخير كل نرد عن اللي قبله
  const EASE_POINTS = [0.15, 0.75, 0.25, 1]; // سريع في البداية وتباطؤ في النهاية
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- 2) عناصر الصفحة ---------- */

  const tray = document.getElementById("dice-tray");
  const totalEl = document.getElementById("dice-total");
  const detailEl = document.getElementById("dice-detail");
  const announceEl = document.getElementById("dice-announce"); // مخفي بصرياً، يعلن النتيجة للقارئ الصوتي
  const rollBtn = document.getElementById("roll-btn");
  const muteBtn = document.getElementById("mute-btn");
  const countInputs = document.querySelectorAll('input[name="dice-count"]');
  const facesInputs = document.querySelectorAll('input[name="dice-faces"]');

  let rolling = false;
  let needsReset = false; // الإعدادات تغيّرت أثناء الرمي

  const selected = (inputs) => Number([...inputs].find((i) => i.checked).value);
  const diceCount = () => selected(countInputs);
  const diceFaces = () => selected(facesInputs);

  /* ---------- 3) الصوت (Web Audio API بدون ملفات) ---------- */

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

  const sound = {
    ctx: null,
    noise: null,
    // الكتم موحّد في كل الموقع: نفس المفتاح المحفوظ في عجلة الأسماء
    muted: storageGet(MUTE_KEY) === "1",

    // المتصفح ما يسمح بالصوت إلا بعد ضغطة من المستخدم، فنجهّزه عند الرمي
    unlock() {
      if (this.muted) return;
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        // ضجيج قصير نستخدمه لصوت "الطَّق" (نجهّزه مرة وحدة)
        const length = Math.floor(this.ctx.sampleRate * 0.08);
        this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },

    // صوت ارتطام خفيف: ضجيج مفلتر + نغمة منخفضة قصيرة
    // delay بالثواني من الحين
    thud(delay = 0) {
      if (this.muted || !this.ctx) return;
      const c = this.ctx;
      const t = c.currentTime + delay;

      const src = c.createBufferSource();
      src.buffer = this.noise;
      const filter = c.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1800 + Math.random() * 600;
      filter.Q.value = 1.2;
      const noiseGain = c.createGain();
      noiseGain.gain.setValueAtTime(0.12, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(filter).connect(noiseGain).connect(c.destination);
      src.start(t);

      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(190, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.08);
      const oscGain = c.createGain();
      oscGain.gain.setValueAtTime(0.0001, t);
      oscGain.gain.exponentialRampToValueAtTime(0.1, t + 0.004);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      osc.connect(oscGain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    },
  };

  // شكل زر الكتم حسب الحالة (نفس زر العجلة)
  function updateMuteButton() {
    muteBtn.textContent = sound.muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(sound.muted));
    muteBtn.setAttribute("aria-label", sound.muted ? "تشغيل الصوت" : "كتم الصوت");
  }

  /* ---------- 4) رسم النرد ---------- */

  // كل الأنواع: مجسّم 3D مرسوم على canvas (من dice3d.js) + ظل تحته وقفزة.
  // الـ canvas ما تقلب ألوانه متصفحات الوضع الليلي الإجباري، عكس ألوان الـ CSS
  function createDie(faces) {
    const die = document.createElement("div");
    die.className = "die";
    const shadow = document.createElement("span");
    shadow.className = "die-shadow";
    const hop = document.createElement("span");
    hop.className = "die-hop";
    die.append(shadow, hop);
    die._poly = Dice3D.create(faces, die, hop);
    die.dataset.value = "";
    return die;
  }

  // يرجّع النرد لحالة "لسه ما انرمى" لما تتغير الإعدادات
  function resetTray() {
    const faces = diceFaces();
    // نوقف متابعة حجم النرد القديم قبل ما نشيله
    [...tray.children].forEach((die) => die._poly.destroy());
    const dice = Array.from({ length: diceCount() }, () => createDie(faces));
    tray.replaceChildren(...dice);
    layoutTray();
    totalEl.textContent = "—";
    detailEl.textContent = "";
  }

  /* ---------- 4ب) توزيع النرد بدون تلامس ---------- */
  // كل نرد ياخذ دائرة آمنة نصف قطرها = أبعد نقطة ممكن يوصلها وهو يدور (أبعد رأس + تكبير المنظور)،
  // فما يتلامس نردين أبداً حتى في أسوأ وضع دوران. بين كل دائرتين مسافة آمنة ثابتة،
  // وبين الصفوف كمان ارتفاع القفزة (لأن النرد اللي تحت ممكن يقفز وهو اللي فوق نازل)

  const PERSPECTIVE = 600; // نفس PERSPECTIVE في dice3d.js
  const HOP_HEIGHT = 22; // أعلى قفزة في animateHop
  const SAFE_GAP = { mobile: 12, desktop: 20 };
  const MAX_PER_ROW = { mobile: 3, desktop: 6 };

  // أبعد مسافة على الشاشة لنقطة على كرة نصف قطرها r بعد المنظور (لأي اتجاه دوران)
  function projectedRadius(r) {
    let max = r;
    for (let i = 0; i <= 90; i++) {
      const a = (i * Math.PI) / 180;
      max = Math.max(max, (r * Math.sin(a) * PERSPECTIVE) / (PERSPECTIVE - r * Math.cos(a)));
    }
    return max;
  }

  function layoutTray() {
    const dice = [...tray.children];
    if (!dice.length) return;
    const desktop = DESKTOP_QUERY.matches;
    const gap = desktop ? SAFE_GAP.desktop : SAFE_GAP.mobile;

    // الحجم الأصلي من الـ CSS (64px أو 76px حسب عرض الشاشة)، قبل أي تصغير
    tray.style.removeProperty("--die-size");
    const baseSize = parseFloat(getComputedStyle(tray).getPropertyValue("--die-size"));
    // نسبة نصف قطر الشكل لحجم المربع حسب نوع النرد (نقرأها من المحرك بعد ما يحسب المقاس)
    dice[0]._poly.resize();
    const shapeRatio = dice[0]._poly.radius / baseSize;
    // نصف قطر الدائرة الآمنة لحجم معيّن (بالمنظور، محسوب على الحجم الأصلي عشان يكون الأحوط)
    const perspectiveFactor = projectedRadius(baseSize * shapeRatio) / (baseSize * shapeRatio);
    const safeRadius = (size) => size * shapeRatio * perspectiveFactor;

    // أكبر حجم يخلي "cols" نرد يكفون في صف واحد
    // (كل نرد حوله نص المسافة الآمنة من الجهتين، فالصف = cols × (قطر + مسافة))
    const width = tray.getBoundingClientRect().width;
    const fitSize = (cols) => (width - cols * gap) / (cols * 2 * shapeRatio * perspectiveFactor);

    // نختار عدد الأعمدة: على الجوال لين 3 في الصف (نفس الشكل القديم) ونصغّر لو لزم.
    // على الكمبيوتر لين 6، ونختار التوزيع اللي يخلي النرد أكبر (وعند التساوي: صفوف أقل)
    const n = dice.length;
    let cols;
    if (desktop) {
      let best = -1;
      for (let rows = Math.ceil(n / MAX_PER_ROW.desktop); rows <= n; rows++) {
        const c = Math.ceil(n / rows);
        const size = Math.min(baseSize, fitSize(c));
        if (size > best + 0.01) {
          best = size;
          cols = c;
        }
      }
    } else {
      cols = Math.min(n, MAX_PER_ROW.mobile);
    }
    // صفوف متوازنة: 5 = 3 + 2، و 4 = 2 + 2
    const rows = Math.ceil(n / cols);
    cols = Math.ceil(n / rows);

    // نصغّر بس لو فيه تلامس فعلي، وبأقل مقدار.
    // الحجم عدد صحيح لأن المحرك يقرأ الحجم بـ clientWidth (يقرّب لأقرب بكسل)،
    // ولو كان فيه كسور كان المحرك يرسم النرد أكبر شوي من الدائرة الآمنة
    const size = Math.min(baseSize, Math.floor(fitSize(cols)));
    const radius = safeRadius(size);
    // المسافة بين المراكز: أفقياً = قطر + مسافة آمنة، وعمودياً كمان + القفزة
    const marginX = (2 * radius + gap - size) / 2;
    const marginY = (2 * radius + gap + HOP_HEIGHT - size) / 2;
    const rowWidth = cols * (size + 2 * marginX);

    if (size < baseSize) tray.style.setProperty("--die-size", `${size}px`);
    tray.style.gap = "0px"; // المسافات كلها صارت في margin كل نرد
    tray.style.setProperty("--die-margin-x", `${marginX}px`);
    tray.style.setProperty("--die-margin-y", `${marginY}px`);
    // padding جانبي يخلي العرض المتاح = صف واحد بالضبط، فالنرد يلتف عند "cols" (+1px هامش للتقريب)
    tray.style.paddingInline = `${Math.max(0, (width - rowWidth) / 2 - 1)}px`;
  }

  let layoutFrame;
  function scheduleLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(layoutTray);
  }

  /* ---------- 5) الحركة ---------- */

  // اتجاه عشوائي (+1 أو -1)
  const randomSign = () => (randomInt(0, 1) ? 1 : -1);

  // قفزة لفوق ثم نزول، والظل يصغر وهو فوق (transform فقط). مشتركة بين كل الأنواع
  function animateHop(die, delay) {
    const hop = die.querySelector(".die-hop");
    const shadow = die.querySelector(".die-shadow");
    hop.animate(
      [
        { transform: "translateY(0)" },
        { transform: "translateY(-22px)", offset: 0.25 },
        { transform: "translateY(0)", offset: 0.55 },
        { transform: "translateY(-6px)", offset: 0.7 },
        { transform: "translateY(0)", offset: 0.85 },
      ],
      { duration: ROLL_DURATION, delay, easing: "ease-in-out", fill: "backwards" }
    );
    // الظل يصغر لما النرد يرتفع
    shadow.animate(
      [
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(0.6)", opacity: 0.45, offset: 0.25 },
        { transform: "scale(1)", opacity: 1, offset: 0.55 },
        { transform: "scale(0.9)", opacity: 0.85, offset: 0.7 },
        { transform: "scale(1)", opacity: 1, offset: 0.85 },
      ],
      { duration: ROLL_DURATION, delay, easing: "ease-in-out", fill: "backwards" }
    );
  }

  // حركة نرد واحد: نفس المدة والتباطؤ والقفزة لكل الأنواع، والدوران يرسمه dice3d.js
  // يرجّع Promise تخلص لما يوقف
  function animateDie(die, value, delay, faces) {
    animateHop(die, delay);
    // ميلان بسيط حول محور الشاشة. في الـ d6 كمان ربع لفّة عشوائية (ما تغيّر الوجه)
    // عشان ترتيب النقاط يختلف كل رمية. في الباقي الرقم يبقى معتدل
    const tiltDeg = (faces === 6 ? randomInt(0, 3) * 90 : 0) + randomInt(-6, 6);
    return die._poly.roll(value, {
      delay,
      duration: ROLL_DURATION,
      easing: EASE_POINTS,
      turnsX: randomInt(1, 3) * randomSign(),
      turnsY: randomInt(1, 3) * randomSign(),
      tilt: (tiltDeg * Math.PI) / 180,
    });
  }

  /* ---------- 6) الرمي ---------- */

  // نكتب النتيجة: على كل نرد (للقارئ الصوتي) وفي المجموع، ونعلنها مرة وحدة
  function showResult(dice, values) {
    dice.forEach((die, i) => {
      die.dataset.value = values[i];
      die._poly.setLabel(`نرد: ${values[i]}`);
    });
    const total = values.reduce((a, b) => a + b, 0);
    totalEl.textContent = total;
    detailEl.textContent = values.length > 1 ? values.join(" + ") : "";
    announceEl.textContent =
      values.length > 1 ? `النتيجة: ${values.join(" و ")}، المجموع ${total}` : `النتيجة: ${total}`;
  }

  function roll() {
    if (rolling) return;
    const faces = diceFaces();
    const dice = [...tray.children];

    // النتيجة تتحدد أول بعشوائية آمنة (crypto)، والحركة للعرض بس
    const values = dice.map(() => randomInt(1, faces));

    sound.unlock();

    // تقليل الحركة: النتيجة تظهر مباشرة بدون دوران
    if (motionQuery.matches) {
      dice.forEach((die, i) => die._poly.show(values[i]));
      showResult(dice, values);
      sound.thud();
      return;
    }

    rolling = true;
    rollBtn.disabled = true;
    tray.classList.add("rolling");
    tray.setAttribute("aria-busy", "true");

    const animations = dice.map((die, i) => {
      const delay = i * STAGGER;
      // صوت الارتطام وقت ما يوقف كل نرد (تقريباً عند 85% من الحركة)
      sound.thud((delay + ROLL_DURATION * 0.85) / 1000);
      die._poly.setLabel("نرد يتدحرج");
      return animateDie(die, values[i], delay, faces);
    });

    // المجموع يتحدث مرة وحدة بعد ما يوقف آخر نرد، فالقارئ الصوتي يقرأ النتيجة النهائية بس
    Promise.allSettled(animations).then(() => {
      showResult(dice, values);
      tray.classList.remove("rolling");
      tray.removeAttribute("aria-busy");
      rolling = false;
      rollBtn.disabled = false;
      if (needsReset) {
        needsReset = false;
        resetTray();
      }
    });
  }

  /* ---------- 7) الأحداث والتشغيل ---------- */

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ count: diceCount(), faces: diceFaces() }));
    } catch (e) {
      // نتجاهل
    }
  }

  // نرجّع آخر إعدادات اختارها المستخدم
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) {
      countInputs.forEach((i) => (i.checked = Number(i.value) === saved.count));
      facesInputs.forEach((i) => (i.checked = Number(i.value) === saved.faces));
      // لو القيمة المحفوظة غريبة نرجع للافتراضي
      if (![...countInputs].some((i) => i.checked)) countInputs[1].checked = true;
      if (![...facesInputs].some((i) => i.checked)) facesInputs[1].checked = true;
    }
  } catch (e) {
    // نتجاهل
  }

  [...countInputs, ...facesInputs].forEach((input) =>
    input.addEventListener("change", () => {
      saveSettings();
      // لو النرد يتدحرج، نستنى لين يوقف عشان النتيجة تطابق النرد الظاهر
      if (rolling) needsReset = true;
      else resetTray();
    })
  );
  rollBtn.addEventListener("click", roll);
  muteBtn.addEventListener("click", () => {
    sound.muted = !sound.muted;
    storageSet(MUTE_KEY, sound.muted ? "1" : "0");
    updateMuteButton();
  });
  tray.addEventListener("click", roll);
  // عرض الشاشة يغيّر عدد النرد في الصف وحجمه
  window.addEventListener("resize", scheduleLayout);
  DESKTOP_QUERY.addEventListener("change", scheduleLayout);

  updateMuteButton();
  resetTray();
})();
