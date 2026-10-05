/* =========================================================
   دوّر — محرك 3D صغير لرسم النرد على canvas (d4, d8, d10, d12, d20)
   بدون مكتبات: الأشكال محسوبة رياضياً، والرسم بترتيب العمق مع إخفاء الأوجه الخلفية
   يُستخدم من dice.js عن طريق window.Dice3D
   الأجزاء بالترتيب:
   1) أدوات المتجهات والـ quaternion  2) بناء الأشكال  3) ترقيم الأوجه
   4) الرسم  5) الحركة  6) النرد الواحد  7) الواجهة العامة
   ========================================================= */

(() => {
  /* ---------- 1) أدوات المتجهات والـ quaternion ---------- */

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = (a) => Math.sqrt(dot(a, a));
  const normalize = (a) => scale(a, 1 / length(a));

  // quaternion بصيغة [w, x, y, z] يمثّل دوران
  const qMul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  const qAxis = (axis, angle) => {
    const s = Math.sin(angle / 2);
    return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
  };
  const X_AXIS = [1, 0, 0];
  const Y_AXIS = [0, 1, 0];
  const Z_AXIS = [0, 0, 1];

  // أقصر طريق بين دورانين (t من 0 إلى 1)
  function qSlerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) {
      b = b.map((v) => -v);
      d = -d;
    }
    if (d > 0.9995) {
      const r = a.map((v, i) => v + (b[i] - v) * t);
      const n = Math.hypot(...r);
      return r.map((v) => v / n);
    }
    const theta = Math.acos(d);
    const s = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / s;
    const wb = Math.sin(t * theta) / s;
    return a.map((v, i) => v * wa + b[i] * wb);
  }

  // مصفوفة 3×3 (صفوف) من quaternion عشان ندوّر كل الرؤوس بسرعة
  function qToMatrix(q) {
    const [w, x, y, z] = q;
    return [
      [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
      [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
      [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ];
  }
  const mApply = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

  // العكس: quaternion من مصفوفة دوران (صفوف)
  function qFromMatrix(m) {
    const t = m[0][0] + m[1][1] + m[2][2];
    let q;
    if (t > 0) {
      const s = 0.5 / Math.sqrt(t + 1);
      q = [0.25 / s, (m[2][1] - m[1][2]) * s, (m[0][2] - m[2][0]) * s, (m[1][0] - m[0][1]) * s];
    } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
      const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]);
      q = [(m[2][1] - m[1][2]) / s, 0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
    } else if (m[1][1] > m[2][2]) {
      const s = 2 * Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]);
      q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s];
    } else {
      const s = 2 * Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]);
      q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s];
    }
    const n = Math.hypot(...q);
    return q.map((v) => v / n);
  }

  /* ---------- 2) بناء الأشكال ---------- */

  const PHI = (1 + Math.sqrt(5)) / 2;
  const EPS = 1e-6;

  // كل الإشارات الممكنة لمتجه: (±a, ±b, ±c) بدون تكرار
  function signs(v) {
    const out = [];
    for (const sx of v[0] ? [1, -1] : [1])
      for (const sy of v[1] ? [1, -1] : [1])
        for (const sz of v[2] ? [1, -1] : [1]) out.push([v[0] * sx, v[1] * sy, v[2] * sz]);
    return out;
  }

  // وجه من مجموعة رؤوس على نفس المستوى: نرتّبها بعكس عقارب الساعة لما نشوفها من برّا
  function makeFace(vertices, idx, normalHint) {
    const pts = idx.map((i) => vertices[i]);
    const center = scale(pts.reduce(add, [0, 0, 0]), 1 / pts.length);
    const n = normalize(normalHint || center);
    const a = normalize(sub(pts[0], center));
    const b = cross(n, a);
    const order = idx
      .map((i) => {
        const d = sub(vertices[i], center);
        return { i, angle: Math.atan2(dot(d, b), dot(d, a)) };
      })
      .sort((p, q) => p.angle - q.angle)
      .map((p) => p.i);
    return { verts: order, normal: n };
  }

  // كل وجه = الرؤوس الأبعد في اتجاه عمودي معيّن (مستوى يلمس الشكل من برّا)
  function facesFromNormals(vertices, normals) {
    return normals.map((nRaw) => {
      const n = normalize(nRaw);
      const max = Math.max(...vertices.map((v) => dot(v, n)));
      const idx = vertices.map((v, i) => (dot(v, n) > max - EPS ? i : -1)).filter((i) => i >= 0);
      return makeFace(vertices, idx, n);
    });
  }

  // رؤوس العشريني (d20): طول كل حافة = 2
  const ICOSA = [...signs([0, 1, PHI]), ...signs([1, PHI, 0]), ...signs([PHI, 0, 1])];

  // مراكز مثلثات العشريني: كل 3 رؤوس المسافة بينهم كلهم = 2 تكوّن وجه
  // نفس النقاط هي رؤوس الاثنا عشري (d12)، لأن الشكلين متقابلين (dual)
  const ICOSA_CENTERS = [];
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      for (let k = j + 1; k < 12; k++) {
        const isEdge = (a, b) => Math.abs(length(sub(ICOSA[a], ICOSA[b])) - 2) < EPS;
        if (isEdge(i, j) && isEdge(j, k) && isEdge(i, k))
          ICOSA_CENTERS.push(scale(add(add(ICOSA[i], ICOSA[j]), ICOSA[k]), 1 / 3));
      }

  // d10 (pentagonal trapezohedron): قمتين فوق وتحت + 10 رؤوس متعرّجة حول الوسط
  // h محسوبة عشان كل وجه (kite) يكون مسطّح تماماً: h = z0 (1 + cos36) / (1 - cos36)
  function trapezohedron() {
    const z0 = 0.1056;
    const c = Math.cos(Math.PI / 5);
    const h = (z0 * (1 + c)) / (1 - c);
    const vertices = [[0, h, 0], [0, -h, 0]];
    for (let k = 0; k < 10; k++) {
      const a = (k * Math.PI) / 5;
      vertices.push([Math.cos(a), k % 2 ? -z0 : z0, Math.sin(a)]);
    }
    const ring = (k) => 2 + (((k % 10) + 10) % 10);
    const faces = [];
    for (let j = 0; j < 5; j++) {
      const top = [0, ring(2 * j), ring(2 * j + 1), ring(2 * j + 2)];
      const bottom = [1, ring(2 * j + 1), ring(2 * j + 2), ring(2 * j + 3)];
      for (const idx of [top, bottom]) {
        const pts = idx.map((i) => vertices[i]);
        // العمودي من حاصل الضرب الاتجاهي لقطري الـ kite، ونقلبه لو كان للداخل
        // (الشكل محدّب ومركزه الأصل، فالعمودي للخارج دائماً في نفس اتجاه مركز الوجه)
        let n = normalize(cross(sub(pts[2], pts[0]), sub(pts[3], pts[1])));
        if (dot(n, pts.reduce(add, [0, 0, 0])) < 0) n = scale(n, -1);
        faces.push({ ...makeFace(vertices, idx, n), apex: idx[0] });
      }
    }
    return { vertices, faces };
  }

  // نصغّر/نكبّر الشكل عشان أبعد رأس يكون على بعد 1 من المركز
  function unitScale(shape) {
    const r = Math.max(...shape.vertices.map(length));
    shape.vertices = shape.vertices.map((v) => scale(v, 1 / r));
    return shape;
  }

  function buildShape(sides) {
    let shape;
    if (sides === 4) {
      const v = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
      shape = { vertices: v, faces: facesFromNormals(v, v.map((p) => scale(p, -1))) };
    } else if (sides === 8) {
      const v = [...signs([1, 0, 0]), ...signs([0, 1, 0]), ...signs([0, 0, 1])];
      shape = { vertices: v, faces: facesFromNormals(v, signs([1, 1, 1])) };
    } else if (sides === 10) {
      shape = trapezohedron();
    } else if (sides === 12) {
      shape = { vertices: ICOSA_CENTERS, faces: facesFromNormals(ICOSA_CENTERS, ICOSA) };
    } else if (sides === 20) {
      shape = { vertices: ICOSA, faces: facesFromNormals(ICOSA, ICOSA_CENTERS) };
    }
    unitScale(shape);
    shape.sides = sides;
    shape.faces.forEach((f) => prepareFace(shape, f));
    numberFaces(shape);
    return shape;
  }

  // معلومات ثابتة لكل وجه: المركز، الاتجاه "فوق" للرقم، والمساحة المتاحة للرقم
  function prepareFace(shape, face) {
    const pts = face.verts.map((i) => shape.vertices[i]);
    // مركز المساحة (مو متوسط الرؤوس) عشان الرقم يجي في وسط الـ kite فعلاً
    const origin = pts[0];
    let areaSum = 0;
    let center = [0, 0, 0];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = dot(cross(sub(pts[i], origin), sub(pts[i + 1], origin)), face.normal) / 2;
      const c = scale(add(add(origin, pts[i]), pts[i + 1]), 1 / 3);
      center = add(center, scale(c, a));
      areaSum += a;
    }
    face.center = scale(center, 1 / areaSum);
    // "فوق" للرقم: نحو القمة في d10، ونحو أول رأس في باقي الأشكال
    const target = face.apex !== undefined ? shape.vertices[face.apex] : pts[0];
    const toward = sub(target, face.center);
    face.up = normalize(sub(toward, scale(face.normal, dot(toward, face.normal))));
    face.right = cross(face.up, face.normal);
    // أقرب مسافة من المركز لأي حافة = نصف قطر الدائرة اللي يتسع لها الرقم
    face.inradius = Math.min(
      ...pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        const edge = normalize(sub(q, p));
        const d = sub(face.center, p);
        return length(sub(d, scale(edge, dot(d, edge))));
      })
    );
  }

  /* ---------- 3) ترقيم الأوجه ---------- */

  // مثل النرد الحقيقي: كل وجهين متقابلين مجموعهم = عدد الأوجه + 1 (ما عدا d4 ما فيه أوجه متقابلة)
  function numberFaces(shape) {
    const n = shape.sides;
    const faces = shape.faces;
    if (n === 4) {
      faces.forEach((f, i) => (f.label = i + 1));
      return;
    }
    let next = 1;
    for (const f of faces) {
      if (f.label) continue;
      const opposite = faces.find((g) => !g.label && g !== f && dot(g.normal, f.normal) < -1 + EPS);
      f.label = next;
      opposite.label = n + 1 - next;
      next++;
    }
  }

  const SHAPES = {};
  [4, 8, 10, 12, 20].forEach((n) => (SHAPES[n] = buildShape(n)));

  // الدوران اللي يخلي وجه معيّن مقابل الشاشة والرقم معتدل:
  // يحوّل (right, up, normal) للوجه إلى (x, y, z) للشاشة
  function faceRotation(shape, value) {
    const f = shape.faces.find((face) => face.label === value);
    return qFromMatrix([f.right, f.up, f.normal]);
  }

  // وضع الوقوف بعد الرمية: الوجه الفائز مقابل الشاشة + ميلان ثابت للـ d4 بس
  // الـ d4 لو وقف مقابل الشاشة بالضبط تختفي أوجهه الثانية وراه ويبان مثلث مسطّح،
  // فنلفّه شوي حول المحور الأفقي والرأسي عشان يبان الوجه الجانبي اللي ورا الحافة اليسار
  // الرقم يبقى معتدل لأن الميلان بعد ما نعدّل اتجاه الرقم
  const REST_TILT = {
    4: qMul(qAxis(X_AXIS, (28 * Math.PI) / 180), qAxis(Y_AXIS, (32 * Math.PI) / 180)),
  };
  function restRotation(shape, value) {
    const q = faceRotation(shape, value);
    return REST_TILT[shape.sides] ? qMul(REST_TILT[shape.sides], q) : q;
  }

  // الوضع قبل أول رمية: وجه عشوائي مايل بزاوية عشوائية (مو مقابل للشاشة بالضبط)
  // الميلان معتدل (22° لين 34°) عشان الأوجه ما تنضغط كثير، والدوران حول الشاشة ±25° عشان الأرقام تنقرأ
  // كل نرد يختلف عن اللي قبله في الوجه اللي قدّام. العشوائية هنا للشكل بس، فـ Math.random تكفي
  let lastIdleFace = null;
  function idlePose(shape) {
    const rand = (min, max) => min + Math.random() * (max - min);
    let face;
    do face = shape.faces[Math.floor(Math.random() * shape.faces.length)].label;
    while (face === lastIdleFace);
    lastIdleFace = face;
    const direction = rand(0, 2 * Math.PI);
    const axis = [Math.cos(direction), Math.sin(direction), 0];
    const tilt = (rand(22, 34) * Math.PI) / 180;
    const spin = (rand(-25, 25) * Math.PI) / 180;
    return qMul(qAxis(Z_AXIS, spin), qMul(qAxis(axis, tilt), faceRotation(shape, face)));
  }

  /* ---------- 4) الرسم ---------- */

  const PERSPECTIVE = 600; // نفس perspective مكعب الـ d6 في CSS
  const LIGHT = normalize([-0.3, 0.45, 0.85]); // الضوء جاي من فوق يسار وقدّام
  // الـ d4 بعد ميلانه (REST_TILT) وجهه الفائز يطالع يمين وتحت شوي، والوجه الجانبي يسار وفوق،
  // فنجيب له الضوء من نفس اتجاه الوجه الفائز عشان يكون هو الأفتح والجانبي أغمق بوضوح
  const LIGHT_BY_SIDES = { 4: normalize([0.4, -0.25, 0.88]) };
  const LIGHT_COLOR = [255, 253, 248]; // نفس لون أوجه مكعب الـ d6
  const DARK_COLOR = [204, 195, 175];
  const EDGE_COLOR = "rgba(28, 35, 33, 0.16)";
  const TEXT_COLOR = "#1c2321"; // نفس لون النقاط في مكعب الـ d6
  const TEXT_UNITS = 100; // الرقم يتقاس بوحدات أكبر عشان الخط ما يصير صغير جداً قبل التكبير
  const FONT = "Cairo, system-ui, sans-serif";

  // حجم الشكل نسبة لحجم مربع النرد (عشان كل الأنواع تبان بنفس الحجم تقريباً)
  const SIZE_FACTOR = { 4: 0.8, 8: 0.68, 10: 0.66, 12: 0.64, 20: 0.64 };

  // كل رقم نرسمه مرة وحدة على canvas صغير (sprite)، وبعدها ننسخه مائل مع الوجه بـ drawImage
  // هذا أسرع بكثير من fillText كل فريم بزاوية مختلفة (المتصفح يعيد رسم الخط من الصفر كل مرة)
  const SPRITE_SCALE = 1.6; // دقة الـ sprite: 160px لكل 100 وحدة نص، تكفي لشاشات retina
  const spriteCache = new Map();
  function labelSprite(text, underline) {
    const key = text + (underline ? "_" : "");
    if (spriteCache.has(key)) return spriteCache.get(key);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const font = `900 ${TEXT_UNITS * SPRITE_SCALE}px ${FONT}`;
    ctx.font = font;
    const m = ctx.measureText(text);
    const ascent = m.actualBoundingBoxAscent;
    const descent = m.actualBoundingBoxDescent;
    // الخط الصغير تحت 6 و 9: المسافة والسماكة نسبة من حجم الخط
    const gap = TEXT_UNITS * SPRITE_SCALE * 0.08;
    const thick = TEXT_UNITS * SPRITE_SCALE * 0.08;
    const pad = 4;
    const boxW = m.width;
    const boxH = ascent + descent + (underline ? gap + thick : 0);
    canvas.width = Math.ceil(boxW + pad * 2);
    canvas.height = Math.ceil(boxH + pad * 2);

    ctx.font = font; // تغيير مقاس الـ canvas يمسح الإعدادات
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const cx = canvas.width / 2;
    const baseline = (canvas.height - boxH) / 2 + ascent;
    ctx.fillText(text, cx, baseline);
    if (underline) {
      const w = boxW * 0.8;
      ctx.fillRect(cx - w / 2, baseline + descent + gap, w, thick);
    }
    // المقاسات بوحدات النص (بدون SPRITE_SCALE) عشان نحسب الحجم المناسب للوجه
    const sprite = {
      canvas,
      width: boxW / SPRITE_SCALE,
      height: boxH / SPRITE_SCALE,
      drawW: canvas.width / SPRITE_SCALE,
      drawH: canvas.height / SPRITE_SCALE,
    };
    spriteCache.set(key, sprite);
    return sprite;
  }

  function shade(normal, light) {
    const k = Math.max(0, dot(normal, light));
    const t = 0.3 + 0.7 * k;
    const c = DARK_COLOR.map((d, i) => Math.round(d + (LIGHT_COLOR[i] - d) * t));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  /* ---------- 5) الحركة ---------- */

  // cubic-bezier مثل CSS: نحل x(t) = الوقت بطريقة Newton ثم نرجّع y(t)
  function bezier(x1, y1, x2, y2) {
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

  // حلقة رسم وحدة لكل النرد المتحرك. تشتغل بس أثناء الحركة وتوقف لما يوقف آخر نرد
  const moving = new Set();
  let loopRunning = false;
  function loop(now) {
    for (const die of moving) die.step(now);
    loopRunning = moving.size > 0;
    if (loopRunning) requestAnimationFrame(loop);
  }
  function startLoop() {
    if (!loopRunning) {
      loopRunning = true;
      requestAnimationFrame(loop);
    }
  }

  /* ---------- 6) النرد الواحد ---------- */

  const allDice = new Set();
  const resizeObserver =
    "ResizeObserver" in window
      ? new ResizeObserver((entries) => entries.forEach((e) => e.target._dice3d && e.target._dice3d.resize()))
      : null;

  class PolyDie {
    // sides: عدد الأوجه، box: العنصر اللي يحدد حجم النرد، parent: مكان الـ canvas
    constructor(sides, box, parent) {
      this.shape = SHAPES[sides];
      this.box = box;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "die-canvas";
      this.ctx = this.canvas.getContext("2d");
      parent.append(this.canvas);
      this.q = idlePose(this.shape);
      this.front = null;
      box._dice3d = this;
      allDice.add(this);
      if (resizeObserver) resizeObserver.observe(box);
    }

    // حجم الـ canvas يتبع حجم النرد في CSS، وحاد على شاشات retina
    resize() {
      const size = this.box.clientWidth;
      if (!size) return;
      const dpr = window.devicePixelRatio || 1;
      this.radius = size * SIZE_FACTOR[this.shape.sides];
      // مساحة زيادة حول الشكل عشان وهو يدور ما ينقص من أطرافه
      const css = Math.ceil(this.radius * 2.5);
      this.cssSize = css;
      this.dpr = dpr;
      this.canvas.style.width = `${css}px`;
      this.canvas.style.height = `${css}px`;
      this.canvas.style.left = `${(size - css) / 2}px`;
      this.canvas.style.top = `${(size - css) / 2}px`;
      this.canvas.width = Math.round(css * dpr);
      this.canvas.height = Math.round(css * dpr);
      this.render();
    }

    // نحوّل نقطة من الشكل لمكانها على الشاشة (مع perspective)
    project(v) {
      const z = v[2] * this.radius;
      const s = PERSPECTIVE / (PERSPECTIVE - z);
      const half = this.cssSize / 2;
      return [half + v[0] * this.radius * s, half - v[1] * this.radius * s, z];
    }

    render() {
      if (!this.cssSize) return;
      const { ctx, shape, dpr } = this;
      const m = qToMatrix(this.q);
      const verts = shape.vertices.map((v) => mApply(m, v));
      const screen = verts.map((v) => this.project(v));
      const camera = [0, 0, PERSPECTIVE / this.radius];

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.cssSize, this.cssSize);

      // نجمع الأوجه الظاهرة بس (backface culling) ونرتبها من الأبعد للأقرب
      const visible = [];
      let bestFacing = -Infinity;
      for (const face of shape.faces) {
        const n = mApply(m, face.normal);
        const c = mApply(m, face.center);
        const facing = dot(n, normalize(sub(camera, c)));
        if (facing <= 0) continue;
        visible.push({ face, n, c, facing });
        if (n[2] > bestFacing) {
          bestFacing = n[2];
          this.front = face.label;
        }
      }
      visible.sort((a, b) => a.c[2] - b.c[2]);

      ctx.lineJoin = "round";
      ctx.lineWidth = 1;
      ctx.strokeStyle = EDGE_COLOR;
      for (const v of visible) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        v.face.verts.forEach((i, k) => {
          const p = screen[i];
          if (k === 0) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
        });
        ctx.closePath();
        ctx.fillStyle = shade(v.n, LIGHT_BY_SIDES[shape.sides] || LIGHT);
        ctx.fill();
        ctx.stroke();
        // الأوجه المايلة كثير ما نكتب عليها (الرقم يصير خط مضغوط ما ينقرأ)
        // الأرقام ما ننرسمها إلا بخط Cairo (ننتظر تحميله)، عشان ما تطلع بخط احتياطي شكله غريب
        if (fontReady && v.facing > 0.2) this.drawLabel(v.face, m, v.facing);
      }
    }

    // الرقم في وسط الوجه، ومائل معه: نحسب تحويل affine من مستوى الوجه للشاشة
    drawLabel(face, m, facing) {
      const { ctx, dpr, shape } = this;
      // تحت 6 و 9 خط صغير يفرّق بينهم (في d10 و d12 و d20)
      const underline = shape.sides >= 10 && (face.label === 6 || face.label === 9);
      const sprite = labelSprite(String(face.label), underline);
      // حجم الرقم (وحدات الشكل لكل وحدة نص): يتسع داخل دائرة نصف قطرها أصغر شوي من أقرب حافة
      const fit = (face.inradius * 0.9) / Math.hypot(sprite.width / 2, sprite.height / 2);
      const k = Math.min(fit, (face.inradius * 1.25) / sprite.height);

      const e = 0.05;
      const p0 = this.project(mApply(m, face.center));
      const px = this.project(mApply(m, add(face.center, scale(face.right, e))));
      const py = this.project(mApply(m, add(face.center, scale(face.up, e))));
      const a = ((px[0] - p0[0]) / e) * k;
      const b = ((px[1] - p0[1]) / e) * k;
      const c = (-(py[0] - p0[0]) / e) * k;
      const d = (-(py[1] - p0[1]) / e) * k;
      ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, p0[0] * dpr, p0[1] * dpr);

      // الرقم يظهر تدريجياً كل ما الوجه يلف قدّام (بدل ما يطلع فجأة)
      ctx.globalAlpha = Math.min(1, (facing - 0.2) / 0.25);
      // الـ sprite متوسّط حول مركز الوجه
      ctx.drawImage(sprite.canvas, -sprite.drawW / 2, -sprite.drawH / 2, sprite.drawW, sprite.drawH);
      ctx.globalAlpha = 1;
    }

    // يحط النرد على وجه معيّن مباشرة (لتقليل الحركة)
    show(value) {
      moving.delete(this);
      this.q = restRotation(this.shape, value);
      this.render();
    }

    // رمية: يدور لفّات كاملة ثم يوقف على الوجه الفائز
    // opts: delay, duration, easing [x1, y1, x2, y2], turnsX, turnsY, tilt (ميلان بسيط حول محور الشاشة بالراديان)
    roll(value, opts) {
      const from = this.q;
      const to = qMul(qAxis(Z_AXIS, opts.tilt || 0), restRotation(this.shape, value));
      const ease = bezier(...opts.easing);
      const start = performance.now() + opts.delay;
      return new Promise((resolve) => {
        this.step = (now) => {
          if (now < start) return; // ننتظر التأخير بدون ما نرسم
          const t = Math.min(1, (now - start) / opts.duration);
          const p = ease(t);
          const rest = 1 - p;
          // لفّات كاملة على محورين تتناقص لين صفر + انتقال سلس للوضع النهائي
          this.q = qMul(
            qAxis(X_AXIS, 2 * Math.PI * opts.turnsX * rest),
            qMul(qAxis(Y_AXIS, 2 * Math.PI * opts.turnsY * rest), qSlerp(from, to, p))
          );
          if (t >= 1) {
            this.q = to;
            moving.delete(this);
            this.render();
            resolve();
            return;
          }
          this.render();
        };
        moving.add(this);
        startLoop();
      });
    }

    destroy() {
      moving.delete(this);
      allDice.delete(this);
      if (resizeObserver) resizeObserver.unobserve(this.box);
      delete this.box._dice3d;
    }
  }

  // نعيد رسم كل النرد (الواقف والمتحرك) بنفس مسار الرسم بالضبط
  function redrawAll() {
    spriteCache.clear(); // صور الأرقام القديمة ممكن تكون بخط ثاني أو مقاس قديم
    allDice.forEach((d) => d.render());
  }

  // الخط: ننتظر Cairo (بحد أقصى 3 ثواني) قبل ما نرسم أي رقم.
  // لو تأخر أكثر نرسم بالخط الاحتياطي، ولما يوصل Cairo بعدين "loadingdone" يعيد الرسم
  let fontReady = !(document.fonts && document.fonts.load);
  if (!fontReady) {
    const loaded = document.fonts.load(`900 20px ${FONT}`, "0123456789").then(() => document.fonts.ready);
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    Promise.race([loaded, timeout])
      .catch(() => {})
      .then(() => {
        fontReady = true;
        redrawAll();
      });
    document.fonts.addEventListener("loadingdone", () => fontReady && redrawAll());
  }

  // لو تغيّرت دقة الشاشة (مثلاً zoom في المتصفح أو نقل النافذة لشاشة ثانية) نعيد مقاس الـ canvas
  // نسمع للـ media query وللـ resize كاحتياط، ونعيد المقاس بس لو الدقة تغيّرت فعلاً
  let lastPixelRatio = window.devicePixelRatio;
  function checkPixelRatio() {
    if (window.devicePixelRatio === lastPixelRatio) return;
    lastPixelRatio = window.devicePixelRatio;
    allDice.forEach((d) => d.resize());
  }
  function watchPixelRatio() {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = () => {
      query.removeEventListener("change", onChange);
      checkPixelRatio();
      watchPixelRatio();
    };
    query.addEventListener("change", onChange);
  }
  watchPixelRatio();
  window.addEventListener("resize", checkPixelRatio);

  /* ---------- 7) الواجهة العامة ---------- */

  window.Dice3D = {
    SHAPES,
    create: (sides, box, parent) => new PolyDie(sides, box, parent),
  };
})();
