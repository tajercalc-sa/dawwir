/* =========================================================
   دوّر — رمي عملة (صورة أو كتابة)
   يعتمد على الدوال المشتركة في common.js: randomInt
   الأجزاء بالترتيب:
   1) الإعدادات  2) عناصر الصفحة  3) العدّاد  4) الصوت  5) قلب العملة  6) الأحداث والتشغيل
   ========================================================= */

(() => {
  /* ---------- 1) الإعدادات ---------- */

  const STORAGE_KEY = "dawwir:coin:stats";
  const MUTE_KEY = "dawwir:muted"; // نفس مفتاح كتم الصوت في باقي الصفحات
  const FLIP_DURATION = 1100; // لازم تطابق مدة الـ transition في CSS
  const RECENT_LIMIT = 12;
  const SIDES = ["صورة", "كتابة"]; // 0 = صورة، 1 = كتابة
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 2) عناصر الصفحة ---------- */

  const $ = (id) => document.getElementById(id);
  const coin = $("coin");
  const coinWrap = $("coin-wrap");
  const resultEl = $("coin-result");
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

  /* ---------- 5) قلب العملة ---------- */

  function flip() {
    if (flipping) return;
    flipping = true;
    flipBtn.disabled = true;

    // النتيجة تتحدد أول بعشوائية آمنة (crypto)
    const side = randomInt(0, 1);

    // نلف 5 لفات كاملة، ونوقف على الوجه الصحيح: الصورة عند 0°، والكتابة عند 180°
    const target = side === 0 ? 0 : 180;
    const delta = (target - (rotation % 360) + 360) % 360;
    rotation += 360 * 5 + delta;

    // الصوت: رنّة القذف الحين، و"التِنغ" مجدول على ساعة الصوت في نفس لحظة وقوف العملة
    const duration = reduceMotion ? 50 : FLIP_DURATION;
    sound.unlock();
    sound.toss();
    sound.land(duration / 1000, !reduceMotion);

    resultEl.textContent = "…";
    coinWrap.classList.remove("tossing");
    void coinWrap.offsetWidth; // نعيد تشغيل حركة القفزة
    coinWrap.classList.add("tossing");
    coin.style.transform = `rotateX(${rotation}deg)`;

    setTimeout(() => {
      resultEl.textContent = SIDES[side];
      if (side === 0) stats.heads++;
      else stats.tails++;
      stats.recent = [side, ...stats.recent].slice(0, RECENT_LIMIT);
      saveStats();
      renderStats();
      flipping = false;
      flipBtn.disabled = false;
    }, duration);
  }

  /* ---------- 6) الأحداث والتشغيل ---------- */

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

  updateMuteButton();
  renderStats();
})();
