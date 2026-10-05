/* =========================================================
   دوّر — تقسيم فرق عشوائي
   يعتمد على الدوال المشتركة في common.js:
   shuffle, parseNames, copyText, showToast
   الأجزاء بالترتيب:
   1) الإعدادات  2) عناصر الصفحة  3) صياغة الأرقام بالعربي
   4) حساب خطة التقسيم  5) التقسيم وعرض الفرق  6) النسخ  7) الأحداث والتشغيل
   ========================================================= */

(() => {
  /* ---------- 1) الإعدادات ---------- */

  const STORAGE_KEY = "dawwir:teams:list";
  const MAX_TEAMS = 100;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // لون مميز لكل فريق (نفس ألوان العجلة)
  const TEAM_COLORS = ["#0e7c66", "#f2a900", "#2f6fb0", "#e76f51", "#264653", "#e9c46a", "#8e5ba8", "#4caf8e"];

  /* ---------- 2) عناصر الصفحة ---------- */

  const $ = (id) => document.getElementById(id);
  const participantsEl = $("participants");
  const countEl = $("participants-count");
  const modeInputs = document.querySelectorAll('input[name="team-mode"]');
  const sizeLabel = $("team-number-label");
  const sizeInput = $("team-number");
  const planEl = $("team-plan");
  const noticeEl = $("teams-notice");
  const splitBtn = $("split-btn");
  const resultEl = $("result");
  const gridEl = $("teams-grid");
  const unevenEl = $("uneven-note");

  let teamNames = [];   // أسماء الفرق اللي عدّلها المستخدم (تبقى حتى لو أعاد التقسيم)
  let lastTeams = null; // آخر تقسيم (للنسخ)

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

  /* ---------- 3) صياغة الأرقام بالعربي ---------- */

  function peopleText(k) {
    if (k === 1) return "شخص واحد";
    if (k === 2) return "شخصين";
    return k <= 10 ? `${k} أشخاص` : `${k} شخص`;
  }
  function teamsText(k) {
    if (k === 2) return "فريقين";
    return k <= 10 ? `${k} فرق` : `${k} فريق`;
  }
  const defaultName = (i) => `الفريق ${i + 1}`;

  /* ---------- 4) حساب خطة التقسيم ---------- */

  const currentMode = () => document.querySelector('input[name="team-mode"]:checked').value;

  // يرجّع عدد الفرق، أو رسالة خطأ لو الإعدادات ما تنفع
  function buildPlan() {
    const names = parseNames(participantsEl.value);
    const n = names.length;
    const value = parseInt(sizeInput.value, 10);
    const mode = currentMode();

    if (n < 2) return { names, error: "اكتب اسمين على الأقل، كل اسم في سطر." };
    if (Number.isNaN(value)) return { names, error: "اكتب رقم في الخانة." };

    let teams;
    if (mode === "count") {
      if (value < 2) return { names, error: "عدد الفرق لازم يكون 2 أو أكثر." };
      if (value > Math.min(n, MAX_TEAMS)) {
        return { names, error: `عدد الفرق (${value}) أكثر من عدد الأسماء (${n}).` };
      }
      teams = value;
    } else {
      if (value < 1) return { names, error: "عدد الأشخاص في الفريق لازم يكون 1 أو أكثر." };
      if (value >= n) return { names, error: `عدد الأشخاص في الفريق لازم يكون أقل من عدد الأسماء (${n}).` };
      // نقرّب للأعلى عشان ما فيه فريق يتعدى العدد المطلوب
      teams = Math.ceil(n / value);
    }

    // لو العدد ما ينقسم بالتساوي: بعض الفرق تاخذ شخص زيادة، والفرق بين أي فريقين شخص واحد بس
    const base = Math.floor(n / teams);
    const extra = n % teams;
    return { names, teams, base, extra };
  }

  // وصف الخطة قبل التقسيم، مثل: "بيطلع 3 فرق: فريق فيه 4 أشخاص، وفريقين فيهم 3 أشخاص"
  function planText({ teams, base, extra }) {
    if (!extra) return `بيطلع ${teamsText(teams)}، كل فريق فيه ${peopleText(base)}.`;
    const bigger = extra === 1 ? "فريق واحد" : teamsText(extra);
    const smaller = teams - extra === 1 ? "فريق واحد" : teamsText(teams - extra);
    return `بيطلع ${teamsText(teams)}: ${bigger} فيها ${peopleText(base + 1)}، و${smaller} فيها ${peopleText(base)}.`;
  }

  function update() {
    countEl.textContent = parseNames(participantsEl.value).length;
    sizeLabel.textContent = currentMode() === "count" ? "عدد الفرق" : "عدد الأشخاص في كل فريق";

    const plan = buildPlan();
    noticeEl.textContent = plan.error || "";
    noticeEl.hidden = !plan.error;
    planEl.textContent = plan.error ? "" : planText(plan);
    splitBtn.disabled = Boolean(plan.error);
    return plan;
  }

  /* ---------- 5) التقسيم وعرض الفرق ---------- */

  function split() {
    const plan = update();
    if (plan.error) return;

    // نخلط الأسماء بعشوائية آمنة (crypto)، ثم نوزّعهم على الفرق بالدور
    const mixed = shuffle(plan.names);
    const teams = Array.from({ length: plan.teams }, () => []);
    mixed.forEach((name, i) => teams[i % plan.teams].push(name));

    lastTeams = teams;
    renderTeams(teams);
    unevenEl.textContent = plan.extra
      ? `العدد ما ينقسم بالتساوي، عشان كذا ${plan.extra === 1 ? "فريق واحد فيه" : `${teamsText(plan.extra)} فيها`} شخص زيادة.`
      : "";
    unevenEl.hidden = !plan.extra;

    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  function renderTeams(teams) {
    gridEl.replaceChildren(
      ...teams.map((members, i) => {
        const card = document.createElement("article");
        card.className = "team-card";
        card.style.setProperty("--team-color", TEAM_COLORS[i % TEAM_COLORS.length]);

        // اسم الفريق قابل للتعديل مباشرة
        const head = document.createElement("div");
        head.className = "team-head";
        const nameInput = document.createElement("input");
        nameInput.className = "team-name";
        nameInput.type = "text";
        nameInput.maxLength = 40;
        nameInput.value = teamNames[i] || defaultName(i);
        nameInput.setAttribute("aria-label", `اسم ${defaultName(i)}`);
        nameInput.addEventListener("input", () => (teamNames[i] = nameInput.value));
        const size = document.createElement("span");
        size.className = "team-size";
        size.textContent = members.length;
        size.setAttribute("aria-label", peopleText(members.length));
        head.append(nameInput, size);

        const list = document.createElement("ul");
        list.className = "team-members";
        list.append(
          ...members.map((m) => {
            const li = document.createElement("li");
            const bdi = document.createElement("bdi");
            bdi.textContent = m;
            li.append(bdi);
            return li;
          })
        );

        card.append(head, list);
        return card;
      })
    );
  }

  /* ---------- 6) النسخ (نص جاهز للواتساب) ---------- */

  function teamsAsText(teams) {
    const lines = [];
    teams.forEach((members, i) => {
      const name = (teamNames[i] || "").trim() || defaultName(i);
      lines.push(`*${name}* (${members.length})`); // النجوم تخلي الاسم عريض في الواتساب
      members.forEach((m) => lines.push(`- ${m}`));
      lines.push("");
    });
    lines.push("تم التقسيم عشوائياً عبر dawwir.net");
    return lines.join("\n");
  }

  /* ---------- 7) الأحداث والتشغيل ---------- */

  participantsEl.addEventListener("input", () => {
    storageSet(STORAGE_KEY, participantsEl.value);
    update();
  });
  sizeInput.addEventListener("input", update);
  modeInputs.forEach((input) =>
    input.addEventListener("change", () => {
      // قيمة افتراضية مناسبة لكل وضع
      sizeInput.value = currentMode() === "count" ? 2 : 3;
      sizeInput.min = currentMode() === "count" ? 2 : 1;
      update();
    })
  );

  splitBtn.addEventListener("click", split);
  $("reshuffle-btn").addEventListener("click", split);
  $("copy-teams-btn").addEventListener("click", async () => {
    if (!lastTeams) return;
    const ok = await copyText(teamsAsText(lastTeams));
    showToast(ok ? "تم نسخ الفرق، الصقها في الواتساب" : "ما قدرنا ننسخ النتيجة");
  });

  // نرجّع آخر قائمة كتبها المستخدم (مفيد لو يقسّم نفس الشلة كل أسبوع)
  const saved = storageGet(STORAGE_KEY);
  if (saved !== null) participantsEl.value = saved;
  update();
})();
