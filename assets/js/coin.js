/* =========================================================
   دوّر — رمي عملة (صورة أو كتابة)
   يعتمد على الدوال المشتركة في common.js: randomInt, cubicBezier
   العملة مرسومة على canvas (مو CSS)، لأن متصفحات الوضع الليلي الإجباري (مثل Samsung Internet)
   تقلب ألوان الـ CSS بس ما تلمس بكسلات الـ canvas، فالعملة تبقى ذهبية في كل الأحوال
   الأجزاء بالترتيب:
   1) الإعدادات  2) عناصر الصفحة  3) العدّاد  4) الصوت  5) رسم العملة  6) قلب العملة  7) الأحداث والتشغيل
   ========================================================= */

(() => {
  /* ---------- 1) الإعدادات ---------- */

  const STORAGE_KEY = "dawwir:coin:stats";
  const MUTE_KEY = "dawwir:muted"; // نفس مفتاح كتم الصوت في باقي الصفحات
  const FLIP_DURATION = 1100; // لازم تطابق مدة حركة القفزة (coin-toss) في CSS
  const FLIP_EASE = cubicBezier(0.2, 0.7, 0.2, 1); // سريع في البداية وتباطؤ في النهاية
  const RECENT_LIMIT = 12;
  const SIDES = ["صورة", "كتابة"]; // 0 = صورة، 1 = كتابة
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- 2) عناصر الصفحة ---------- */

  const $ = (id) => document.getElementById(id);
  const coin = $("coin"); // الـ canvas
  const coinWrap = $("coin-wrap");
  const resultEl = $("coin-result");
  const announceEl = $("coin-announce"); // مخفي بصرياً، يعلن النتيجة للقارئ الصوتي
  const flipBtn = $("flip-btn");
  const muteBtn = $("mute-btn");
  const headsEl = $("heads-count");
  const tailsEl = $("tails-count");
  const totalEl = $("flips-total");
  const recentEl = $("recent-flips");

  let rotation = 0;   // زاوية العملة الحالية بالدرجات
  let flipping = false;

  /* ---------- 3) العدّاد (محفوظ في الجهاز) ---------- */

  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (s && Array.isArray(s.recent)) return s;
    } catch (e) {
      // نتجاهل
    }
    return { heads: 0, tails: 0, recent: [] };
  }
  let stats = loadStats();

  function saveStats() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch (e) {
      // نتجاهل
    }
  }

  const percent = (part, total) => (total ? Math.round((part / total) * 100) : 0);

  function renderStats() {
    const total = stats.heads + stats.tails;
    headsEl.textContent = `${stats.heads} (${percent(stats.heads, total)}%)`;
    tailsEl.textContent = `${stats.tails} (${percent(stats.tails, total)}%)`;
    totalEl.textContent = total;
    // آخر النتائج: الأحدث أول
    recentEl.replaceChildren(
      ...stats.recent.map((side) => {
        const li = document.createElement("li");
        li.className = side === 0 ? "recent-heads" : "recent-tails";
        li.textContent = side === 0 ? "ص" : "ك";
        li.title = SIDES[side];
        return li;
      })
    );
    recentEl.parentElement.hidden = !stats.recent.length;
  }

  /* ---------- 4) الصوت (Web Audio API بدون ملفات) ---------- */

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

  // نسب ترددات غير متناسقة (inharmonic) مثل المعدن: مو مضاعفات صحيحة للتردد الأساسي
  // لكل نغمة: النسبة، قوتها، ومدة تلاشيها بالثواني (النغمات العالية تتلاشى أسرع)
  const METAL_PARTIALS = [
    { ratio: 1, gain: 1, decay: 0.9 },
    { ratio: 2.32, gain: 0.55, decay: 0.65 },
    { ratio: 3.87, gain: 0.32, decay: 0.45 },
    { ratio: 5.43, gain: 0.18, decay: 0.3 },
  ];

  const sound = {
    ctx: null,
    master: null,
    muted: storageGet(MUTE_KEY) === "1",

    // المتصفح ما يسمح بالصوت إلا بعد ضغطة من المستخدم، فنجهّزه عند ضغط "اقلب العملة"
    unlock() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        // كل الأصوات تمر من هنا: لو المستخدم كتم أثناء القذف نسكّت الصوت المجدول فوراً
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },

    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.setValueAtTime(muted ? 0 : 1, this.ctx.currentTime);
    },

    // ضربة معدنية: كم نغمة sine تبدأ فجأة وتتلاشى exponential
    // base: التردد الأساسي، volume: الارتفاع، length: نسبة طول التلاشي، delay: بعد كم ثانية
    strike(base, volume, length, delay) {
      const c = this.ctx;
      const t = c.currentTime + delay;
      for (const part of METAL_PARTIALS) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        const end = t + part.decay * length;
        osc.type = "sine";
        osc.frequency.value = base * part.ratio;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(volume * part.gain, t + 0.002); // بداية فجأة (2ms)
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain).connect(this.master);
        osc.start(t);
        osc.stop(end + 0.02);
      }
    },

    // اختلاف عشوائي بسيط في الطبقة (±4%) عشان كل رمية صوتها مختلف شوي
    // (هذا للصوت بس، فـ Math.random تكفي، والنتيجة نفسها من crypto)
    vary(freq) {
      return freq * (1 + (Math.random() * 2 - 1) * 0.04);
    },

    // عند القذف: رنّة خفيفة قصيرة
    toss() {
      if (this.muted || !this.ctx) return;
      this.strike(this.vary(2600), 0.025, 0.3, 0);
    },

    // عند التوقف: "تِنغ" واضح، وبعده ارتدادين أخف وأقرب من بعض (لو الحركة مو مقللة)
    land(delay, withBounces) {
      if (this.muted || !this.ctx) return;
      const base = this.vary(1700);
      this.strike(base, 0.09, 1, delay);
      if (!withBounces) return;
      this.strike(this.vary(base), 0.04, 0.45, delay + 0.14);
      this.strike(this.vary(base), 0.02, 0.3, delay + 0.23);
    },
  };

  function updateMuteButton() {
    muteBtn.textContent = sound.muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(sound.muted));
    muteBtn.setAttribute("aria-label", sound.muted ? "تشغيل الصوت" : "كتم الصوت");
  }

  /* ---------- 5) رسم العملة ---------- */

  const SIZE = 170; // مقاس الـ canvas بالـ CSS px
  const RADIUS = 84;
  const THICKNESS = 10; // سُمك العملة اللي يبان من الحافة وهي مايلة
  // كل الألوان قيم صريحة. الذهبي أفتح شوي في الوضع الداكن (مثل باقي ألوان الموقع)
  const GOLD_LIGHT = "#ffd860";
  const GOLD = { light: "#f2a900", dark: "#f2b632" };
  const GOLD_EDGE = "#c98b00"; // الحافة أغمق من الوسط
  const RIM_COLOR = "#a87400"; // خط رفيع حول العملة
  const SIDE_DARK = "#8a6000"; // جنب العملة (السُّمك)
  const TEXT_COLOR = "#4a3500";
  const FONT = "900 30px Cairo, system-ui, sans-serif";
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const ctx = coin.getContext("2d");
  let dpr = 1;

  // الكتابة ما نرسمها إلا بخط Cairo (ننتظر تحميله بحد أقصى 3 ثواني، مثل أرقام النرد)
  let fontReady = !(document.fonts && document.fonts.load);
  if (!fontReady) {
    const loaded = document.fonts.load(FONT, SIDES.join("")).then(() => document.fonts.ready);
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    Promise.race([loaded, timeout])
      .catch(() => {})
      .then(() => {
        fontReady = true;
        draw(rotation);
      });
  }

  // حجم الـ canvas حسب دقة الشاشة عشان العملة تطلع حادة على شاشات retina
  function sizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    coin.width = Math.round(SIZE * dpr);
    coin.height = Math.round(SIZE * dpr);
    draw(rotation);
  }

  // وجه واحد (دائرة ذهبية + حلقتين + الكلمة)، مرسوم حول (0, 0)
  // التدرج نفس radial-gradient(circle at 35% 30%) القديم: المركز فوق يسار، والحافة أغمق
  function drawFace(side, light) {
    const g = ctx.createRadialGradient(-25.5, -34, 0, -25.5, -34, 162);
    g.addColorStop(0, GOLD_LIGHT);
    g.addColorStop(0.6, darkQuery.matches ? GOLD.dark : GOLD.light);
    g.addColorStop(1, GOLD_EDGE);
    ctx.beginPath();
    ctx.arc(0, 0, RADIUS, 0, 2 * Math.PI);
    ctx.fillStyle = g;
    ctx.fill();
    // حلقتين داخليتين: بني خفيف، وفوقه أبيض شفاف (مثل box-shadow القديم)
    ctx.lineWidth = 12;
    ctx.strokeStyle = "rgba(74, 53, 0, 0.2)";
    ctx.beginPath();
    ctx.arc(0, 0, RADIUS - 6, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.arc(0, 0, RADIUS - 4, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = RIM_COLOR;
    ctx.beginPath();
    ctx.arc(0, 0, RADIUS - 0.75, 0, 2 * Math.PI);
    ctx.stroke();
    if (fontReady) {
      ctx.fillStyle = TEXT_COLOR;
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(SIDES[side], 0, 2);
    }
    // كل ما مالت العملة (الوجه يطالع بعيد) يغمق شوي، عشان يبان الدوران
    if (light < 1) {
      ctx.beginPath();
      ctx.arc(0, 0, RADIUS, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(40, 25, 0, ${(1 - light) * 0.35})`;
      ctx.fill();
    }
  }

  // العملة بزاوية deg حول المحور الأفقي (مثل rotateX):
  // الارتفاع = cos(الزاوية)، والسُّمك يبان من الحافة = sin(الزاوية)
  function draw(deg) {
    const a = (deg * Math.PI) / 180;
    const squash = Math.abs(Math.cos(a));
    const depth = THICKNESS * Math.sin(a); // موجب: الحافة تبان تحت، سالب: فوق
    // 0° = صورة، 180° = كتابة (الوجه الخلفي يطلع معتدل مو مقلوب)
    const side = Math.cos(a) >= 0 ? 0 : 1;
    const c = SIZE / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    // جنب العملة: الوجه الثاني (مزاح) + مستطيل يوصل بينهم
    if (Math.abs(depth) > 0.3) {
      const band = ctx.createLinearGradient(c - RADIUS, 0, c + RADIUS, 0);
      band.addColorStop(0, SIDE_DARK);
      band.addColorStop(0.5, GOLD_EDGE);
      band.addColorStop(1, SIDE_DARK);
      ctx.fillStyle = band;
      ctx.beginPath();
      ctx.ellipse(c, c + depth / 2, RADIUS, Math.max(RADIUS * squash, 0.01), 0, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillRect(c - RADIUS, c - Math.abs(depth) / 2, RADIUS * 2, Math.abs(depth));
    }

    // الوجه الظاهر، مضغوط رأسياً حسب الميلان
    if (squash > 0.01) {
      ctx.setTransform(dpr, 0, 0, dpr * squash, c * dpr, (c - depth / 2) * dpr);
      drawFace(side, 0.7 + 0.3 * squash);
    }
  }

  // نعيد الرسم لو تغيرت دقة الشاشة (zoom أو نقل النافذة لشاشة ثانية)
  function watchPixelRatio() {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", function onChange() {
      query.removeEventListener("change", onChange);
      sizeCanvas();
      watchPixelRatio();
    });
  }

  /* ---------- 6) قلب العملة ---------- */

  // حركة من زاوية لزاوية بـ requestAnimationFrame
  function animate(from, to, duration) {
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        draw(from + (to - from) * FLIP_EASE(t));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  function flip() {
    if (flipping) return;
    flipping = true;
    flipBtn.disabled = true;

    // النتيجة تتحدد أول بعشوائية آمنة (crypto)، والحركة للعرض بس
    const side = randomInt(0, 1);

    // نلف 5 لفات كاملة، ونوقف على الوجه الصحيح: الصورة عند 0°، والكتابة عند 180°
    const from = rotation;
    const target = side === 0 ? 0 : 180;
    const delta = (target - (rotation % 360) + 360) % 360;
    rotation += 360 * 5 + delta;

    // تقليل الحركة: النتيجة تظهر مباشرة بدون دوران
    const reduceMotion = motionQuery.matches;
    const duration = reduceMotion ? 50 : FLIP_DURATION;

    // الصوت: رنّة القذف الحين، و"التِنغ" مجدول على ساعة الصوت في نفس لحظة وقوف العملة
    sound.unlock();
    sound.toss();
    sound.land(duration / 1000, !reduceMotion);

    resultEl.textContent = "…";
    coin.setAttribute("aria-label", "عملة تتقلب");
    coinWrap.classList.remove("tossing");
    void coinWrap.offsetWidth; // نعيد تشغيل حركة القفزة
    coinWrap.classList.add("tossing");
    if (reduceMotion) draw(rotation);
    else animate(from, rotation, FLIP_DURATION);

    setTimeout(() => {
      draw(rotation); // نتأكد إن العملة واقفة على الوجه الصحيح بالضبط
      resultEl.textContent = SIDES[side];
      coin.setAttribute("aria-label", `عملة: ${SIDES[side]}`);
      announceEl.textContent = `النتيجة: ${SIDES[side]}`;
      if (side === 0) stats.heads++;
      else stats.tails++;
      stats.recent = [side, ...stats.recent].slice(0, RECENT_LIMIT);
      saveStats();
      renderStats();
      flipping = false;
      flipBtn.disabled = false;
    }, duration);
  }

  /* ---------- 7) الأحداث والتشغيل ---------- */

  flipBtn.addEventListener("click", flip);
  muteBtn.addEventListener("click", () => {
    sound.setMuted(!sound.muted);
    storageSet(MUTE_KEY, sound.muted ? "1" : "0");
    updateMuteButton();
  });
  coinWrap.addEventListener("click", flip);
  $("reset-coin-btn").addEventListener("click", () => {
    stats = { heads: 0, tails: 0, recent: [] };
    saveStats();
    renderStats();
    resultEl.textContent = "—";
  });

  // دقة الشاشة، وتغيّر الوضع الفاتح/الداكن (لون الذهبي يختلف شوي)
  watchPixelRatio();
  window.addEventListener("resize", () => {
    if ((window.devicePixelRatio || 1) !== dpr) sizeCanvas();
  });
  darkQuery.addEventListener("change", () => draw(rotation));

  updateMuteButton();
  renderStats();
  sizeCanvas();
})();
