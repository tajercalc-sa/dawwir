/* =========================================================
   دوّر — رمي النرد
   يعتمد على الدوال المشتركة في common.js: randomInt
   وعلى محرك الـ 3D في dice3d.js لرسم d4, d8, d10, d12, d20 (نرد الـ d6 مكعب CSS)
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
  const EASE_OUT = `cubic-bezier(${EASE_POINTS.join(", ")})`;
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  // أماكن النقاط في نرد الـ 6 أوجه، على شبكة 3×3 (الخانات من 0 إلى 8)
  const PIPS = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };

  // مكان كل وجه على المكعب (مثل النرد الحقيقي: كل وجهين متقابلين مجموعهم 7)
  const FACE_CLASS = { 1: "front", 6: "back", 3: "right", 4: "left", 2: "top", 5: "bottom" };

  // دوران المكعب اللي يخلي الوجه المطلوب مقابل الشاشة: [محور X, محور Y]
  const FACE_ROTATION = {
    1: [0, 0],
    6: [0, 180],
    3: [0, -90],
    4: [0, 90],
    2: [-90, 0],
    5: [90, 0],
  };

  /* ---------- 2) عناصر الصفحة ---------- */

  const tray = document.getElementById("dice-tray");
  const totalEl = document.getElementById("dice-total");
  const detailEl = document.getElementById("dice-detail");
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

  // وجه واحد من المكعب: 9 خانات والنقاط تنور حسب الرقم
  function createFace(value) {
    const face = document.createElement("span");
    face.className = `cube-face cube-${FACE_CLASS[value]}`;
    for (let i = 0; i < 9; i++) {
      const pip = document.createElement("span");
      pip.className = PIPS[value].includes(i) ? "pip on" : "pip";
      face.append(pip);
    }
    return face;
  }

  // نرد 6 أوجه: مكعب 3D فيه 6 أوجه + ظل تحته
  function createCube() {
    const die = document.createElement("div");
    die.className = "die die-3d";
    const shadow = document.createElement("span");
    shadow.className = "die-shadow";
    const hop = document.createElement("span");
    hop.className = "die-hop";
    const cube = document.createElement("span");
    cube.className = "cube";
    // 3 ألواح داخلية تسد الفراغ عند الزوايا المدوّرة
    for (let i = 0; i < 3; i++) {
      const core = document.createElement("span");
      core.className = `cube-core cube-core-${i}`;
      cube.append(core);
    }
    for (let v = 1; v <= 6; v++) cube.append(createFace(v));
    hop.append(cube);
    die.append(shadow, hop);
    return die;
  }

  // باقي الأنواع: مجسّم 3D مرسوم على canvas (من dice3d.js) + نفس الظل والقفزة
  function createPolyDie(faces) {
    const die = document.createElement("div");
    die.className = "die die-poly";
    const shadow = document.createElement("span");
    shadow.className = "die-shadow";
    const hop = document.createElement("span");
    hop.className = "die-hop";
    die.append(shadow, hop);
    die._poly = Dice3D.create(faces, die, hop);
    return die;
  }

  function createDie(faces) {
    const die = faces === 6 ? createCube() : createPolyDie(faces);
    die.setAttribute("role", "img");
    die.setAttribute("aria-label", "نرد");
    die.dataset.value = "";
    return die;
  }

  // يرجّع النرد لحالة "لسه ما انرمى" لما تتغير الإعدادات
  function resetTray() {
    const faces = diceFaces();
    // نوقف متابعة حجم النرد القديم قبل ما نشيله
    [...tray.children].forEach((die) => die._poly && die._poly.destroy());
    const dice = Array.from({ length: diceCount() }, () => createDie(faces));
    tray.replaceChildren(...dice);
    // المكعب يبدأ مائل شوي عشان يبان إنه 3D
    dice.forEach((die) => {
      if (faces === 6) setCubeAngles(die, { x: -16, y: 22, z: 0 });
    });
    totalEl.textContent = "—";
    detailEl.textContent = "";
  }

  /* ---------- 5) الحركة ---------- */

  const cubeTransform = (a) => `rotateZ(${a.z}deg) rotateX(${a.x}deg) rotateY(${a.y}deg)`;

  // نحفظ زاوية المكعب الحالية عشان الرمية الجاية تبدأ منها بدون قفزة
  function setCubeAngles(die, angles) {
    const cube = die.querySelector(".cube");
    die._angles = angles;
    cube.style.transform = cubeTransform(angles);
  }

  // اتجاه عشوائي (+1 أو -1)
  const randomSign = () => (randomInt(0, 1) ? 1 : -1);

  // زوايا النهاية: الوجه المطلوب مقابل الشاشة + لفّات كاملة عشوائية على المحورين
  // اللفّات الكاملة (مضاعفات 360) ما تغيّر الوجه اللي يوقف عليه
  function targetAngles(value, from) {
    const [baseX, baseY] = FACE_ROTATION[value];
    const turnsX = randomInt(1, 3) * randomSign();
    const turnsY = randomInt(1, 3) * randomSign();
    // دوران حول محور الشاشة (Z) ما يغيّر الوجه الأمامي، بس يخلي شكل النقاط مختلف كل مرة
    const z = randomInt(0, 3) * 90 + randomInt(-6, 6);
    return {
      x: baseX + 360 * (Math.round(from.x / 360) + turnsX),
      y: baseY + 360 * (Math.round(from.y / 360) + turnsY),
      z,
    };
  }

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

  // حركة مكعب واحد. يرجّع Promise تخلص لما يوقف
  function animateCube(die, value, delay) {
    const cube = die.querySelector(".cube");
    const from = die._angles;
    const to = targetAngles(value, from);
    setCubeAngles(die, to);

    const timing = { duration: ROLL_DURATION, delay, easing: EASE_OUT, fill: "backwards" };
    const spin = cube.animate([{ transform: cubeTransform(from) }, { transform: cubeTransform(to) }], timing);
    animateHop(die, delay);
    return spin.finished;
  }

  // حركة باقي الأنواع: نفس المدة والتباطؤ والقفزة، والدوران يرسمه dice3d.js
  function animatePoly(die, value, delay) {
    animateHop(die, delay);
    return die._poly.roll(value, {
      delay,
      duration: ROLL_DURATION,
      easing: EASE_POINTS,
      turnsX: randomInt(1, 3) * randomSign(),
      turnsY: randomInt(1, 3) * randomSign(),
      tilt: (randomInt(-6, 6) * Math.PI) / 180, // ميلان بسيط مثل الـ d6، والرقم يبقى معتدل
    });
  }

  /* ---------- 6) الرمي ---------- */

  // نكتب النتيجة: على كل نرد (للقارئ الصوتي) وفي المجموع
  function showResult(dice, values) {
    dice.forEach((die, i) => {
      die.dataset.value = values[i];
      die.setAttribute("aria-label", `نرد: ${values[i]}`);
    });
    totalEl.textContent = values.reduce((a, b) => a + b, 0);
    detailEl.textContent = values.length > 1 ? values.join(" + ") : "";
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
      dice.forEach((die, i) => {
        if (faces === 6) setCubeAngles(die, { x: FACE_ROTATION[values[i]][0], y: FACE_ROTATION[values[i]][1], z: 0 });
        else die._poly.show(values[i]);
      });
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
      die.setAttribute("aria-label", "نرد يتدحرج");
      return faces === 6 ? animateCube(die, values[i], delay) : animatePoly(die, values[i], delay);
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
