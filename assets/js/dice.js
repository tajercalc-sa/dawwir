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
    totalEl.textContent = "—";
    detailEl.textContent = "";
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

  updateMuteButton();
  resetTray();
})();
