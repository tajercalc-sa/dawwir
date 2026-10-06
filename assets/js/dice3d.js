/* =========================================================
   دوّر — محرك 3D صغير لرسم النرد على canvas (d4, d6, d8, d10, d12, d20)
   بدون مكتبات: الأشكال محسوبة رياضياً، والرسم بترتيب العمق مع إخفاء الأوجه الخلفية
   ليش canvas؟ متصفحات الوضع الليلي الإجباري (مثل Samsung Internet) تقلب ألوان الـ CSS،
   بس ما تلمس بكسلات الـ canvas، فالنرد يبقى عاجي في كل الأحوال
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
    } else if (sides === 6) {
      const v = signs([1, 1, 1]);
      shape = { vertices: v, faces: facesFromNormals(v, [...signs([1, 0, 0]), ...signs([0, 1, 0]), ...signs([0, 0, 1])]) };
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
    if (sides === 6) shape.faces.forEach(prepareCubeFace);
    numberFaces(shape);
    return shape;
  }

  // وجه المكعب: "فوق" موازي لحافة (مو للزاوية مثل باقي الأشكال) عشان النقاط تجي على شبكة مستقيمة،
  // وحدود الوجه مربع بزوايا مدوّرة (نفس border-radius: 18% في المكعب القديم)
  const CUBE_CORNER = 0.36; // نصف قطر الزاوية نسبة من نصف الضلع (18% من الضلع)
  function prepareCubeFace(face) {
    const n = face.normal;
    face.up = Math.abs(n[1]) > 0.5 ? [0, 0, -n[1]] : [0, 1, 0];
    face.right = cross(face.up, face.normal);
    const half = face.inradius; // في المكعب: المسافة من المركز للحافة = نصف الضلع
    const r = half * CUBE_CORNER;
    // نقاط الحد: ربع دائرة عند كل زاوية (7 نقاط لكل ربع)
    face.outline = [];
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    corners.forEach(([sx, sy], k) => {
      const cx = sx * (half - r);
      const cy = sy * (half - r);
      const start = (k * Math.PI) / 2;
      for (let i = 0; i <= 6; i++) {
        const a = start + (i / 6) * (Math.PI / 2);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        face.outline.push(add(face.center, add(scale(face.right, x), scale(face.up, y))));
      }
    });
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
  [4, 6, 8, 10, 12, 20].forEach((n) => (SHAPES[n] = buildShape(n)));

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

  // الوضع قبل أول رمية: وجه عشوائي بميلان مقيّد، عشان النرد يبان مجسّم والأرقام تنقرأ،
  // وعشان شكله ما يصير أعرض من اللازم (dice.js يحسب المسافات من أعرض وضعية مسموحة، في restingExtent)
  //  - الميلان 10° لين 18°، واتجاهه قريب من الرأسي (±30°): يبان شوي من الوجه اللي فوق أو اللي تحت
  //  - الدوران حول الشاشة ±6° بس، وفي الـ d6 ربع لفّة عشوائية (تغيّر ترتيب النقاط بس، مو شكل المكعب)
  //  - الـ d4 ميلانه هو ميلان الاستقرار نفسه (REST_TILT)، لأن أي ميلان زيادة يخليه أعرض بكثير
  // كل نرد يختلف عن اللي قبله في الوجه اللي قدّام. العشوائية هنا للشكل بس، فـ Math.random تكفي
  const DEG = Math.PI / 180;
  const IDLE_TILT = [10, 18];
  const IDLE_TILT_DIRECTION = 30;
  const IDLE_SPIN = 6;

  // direction: اتجاه محور الميلان بالدرجات (0 = أفقي فيبان الوجه اللي فوق، 180 = يبان اللي تحت)
  function idleRotation(shape, face, tilt, direction, spin, quarter) {
    const turn = qAxis(Z_AXIS, spin * DEG);
    if (shape.sides === 4) return qMul(turn, restRotation(shape, face));
    const axis = [Math.cos(direction * DEG), Math.sin(direction * DEG), 0];
    const front = qMul(qAxis(Z_AXIS, quarter * 90 * DEG), faceRotation(shape, face));
    return qMul(turn, qMul(qAxis(axis, tilt * DEG), front));
  }

  let lastIdleFace = null;
  function idlePose(shape) {
    const rand = (min, max) => min + Math.random() * (max - min);
    let face;
    do face = shape.faces[Math.floor(Math.random() * shape.faces.length)].label;
    while (face === lastIdleFace);
    lastIdleFace = face;
    const tilt = rand(...IDLE_TILT);
    const direction = rand(-IDLE_TILT_DIRECTION, IDLE_TILT_DIRECTION) + (Math.random() < 0.5 ? 0 : 180);
    const spin = rand(-IDLE_SPIN, IDLE_SPIN);
    const quarter = shape.sides === 6 ? Math.floor(Math.random() * 4) : 0;
    return idleRotation(shape, face, tilt, direction, spin, quarter);
  }

  /* ---------- 4) الرسم ---------- */

  const PERSPECTIVE = 600;
  const LIGHT = normalize([-0.3, 0.45, 0.85]); // الضوء جاي من فوق يسار وقدّام
  // الـ d4 بعد ميلانه (REST_TILT) وجهه الفائز يطالع يمين وتحت شوي، والوجه الجانبي يسار وفوق،
  // فنجيب له الضوء من نفس اتجاه الوجه الفائز عشان يكون هو الأفتح والجانبي أغمق بوضوح.
  // الـ d6 يوقف ووجهه مقابل الشاشة، فنخلي الضوء شبه أمامي عشان الوجه الفائز يطلع عاجي فاتح
  const LIGHT_BY_SIDES = { 4: normalize([0.4, -0.25, 0.88]), 6: normalize([-0.2, 0.3, 0.93]) };
  const LIGHT_COLOR = [255, 253, 248]; // عاجي (#fffdf8)
  const DARK_COLOR = [204, 195, 175];
  const EDGE_COLOR = "rgba(28, 35, 33, 0.16)";
  const TEXT_COLOR = "#1c2321"; // نفس لون نقاط الـ d6
  const TEXT_UNITS = 100; // الرقم يتقاس بوحدات أكبر عشان الخط ما يصير صغير جداً قبل التكبير
  const FONT = "Cairo, system-ui, sans-serif";

  // ألوان المكعب (d6)
  const CUBE_BODY = "rgb(214, 206, 189)"; // الجسم اللي يبان عند الزوايا المدوّرة بين الأوجه
  const CUBE_INNER_SHADOW = "rgba(0, 0, 0, 0.08)";
  const PIP_LIGHT = "#33403c"; // النقطة محفورة: أفتح شوي تحت وأغمق فوق
  const PIP_DARK = "#121715";

  // أماكن النقاط في الـ d6 على شبكة 3×3 (الخانات من 0 إلى 8، صف صف من فوق)
  const PIPS = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const PIP_OFFSET = 0.507; // بعد صفوف/أعمدة النقاط عن المركز (نسبة من نصف الضلع)
  const PIP_RADIUS = 0.182; // نصف قطر النقطة (نسبة من نصف الضلع)

  // حجم الشكل نسبة لحجم مربع النرد (عشان كل الأنواع تبان بنفس الحجم تقريباً)
  // الـ d6: ضلع المكعب = حجم المربع بالضبط (نصف قطر المكعب = √3 / 2 من الضلع)
  const SIZE_FACTOR = { 4: 0.8, 6: Math.sqrt(3) / 2, 8: 0.68, 10: 0.66, 12: 0.64, 20: 0.64 };

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

  // لون الوجه حسب زاويته مع الضوء: [r, g, b]
  function shadeRGB(normal, light) {
    const k = Math.max(0, dot(normal, light));
    const t = 0.3 + 0.7 * k;
    return DARK_COLOR.map((d, i) => Math.round(d + (LIGHT_COLOR[i] - d) * t));
  }
  const rgb = (c) => `rgb(${c.map(Math.round).join(", ")})`;
  const shade = (normal, light) => rgb(shadeRGB(normal, light));
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  // أبسط غلاف محدّب (convex hull) لنقاط على الشاشة، بطريقة monotone chain
  function convexHull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => {
      const out = [];
      for (const q of list) {
        while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
        out.push(q);
      }
      out.pop();
      return out;
    };
    return [...half(p), ...half(p.reverse())];
  }

  /* ---------- 5) الحركة ---------- */
  // التباطؤ (cubicBezier) في common.js، لأن العملة تستخدمه كمان

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
      // للقارئ الصوتي: الـ canvas صورة، ووصفها يتحدث مع النتيجة (setLabel)
      this.canvas.setAttribute("role", "img");
      this.canvas.setAttribute("aria-label", "نرد");
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

      if (shape.sides === 6) {
        this.renderCube(visible, m);
        return;
      }

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

    // المكعب (d6): جسم بزوايا مدوّرة، وأوجه عاجية بتدرج وظل داخلي، ونقاط داكنة
    renderCube(visible, m) {
      const { ctx, dpr, shape } = this;
      const light = LIGHT_BY_SIDES[6];
      const toScreen = (p) => this.project(mApply(m, p));
      const tracePath = (points) => {
        ctx.beginPath();
        points.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
      };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 1) الجسم: الغلاف المحدّب لحدود كل الأوجه (المدوّرة)، فيطلع شكل خارجي بزوايا ناعمة
      //    ويسد الفراغ اللي تتركه الزوايا المدوّرة بين الأوجه
      const all = [];
      shape.faces.forEach((f) => f.outline.forEach((p) => all.push(toScreen(p))));
      tracePath(convexHull(all));
      ctx.fillStyle = CUBE_BODY;
      ctx.fill();

      ctx.lineJoin = "round";
      for (const v of visible) {
        const face = v.face;
        const outline = face.outline.map(toScreen);
        const base = shadeRGB(v.n, light);
        // تدرج دائري: الوسط أفتح (قريب من العاجي) والأطراف أغمق شوي، مثل radial-gradient القديم
        const center = toScreen(add(face.center, scale(face.up, face.inradius * 0.1)));
        const corner = toScreen(face.outline[0]);
        const radius = Math.hypot(corner[0] - center[0], corner[1] - center[1]);
        const gradient = ctx.createRadialGradient(center[0], center[1], 0, center[0], center[1], radius);
        gradient.addColorStop(0, rgb(mix(base, LIGHT_COLOR, 0.6)));
        gradient.addColorStop(0.55, rgb(mix(base, LIGHT_COLOR, 0.6)));
        gradient.addColorStop(1, rgb(base.map((c) => c * 0.93)));

        tracePath(outline);
        ctx.fillStyle = gradient;
        ctx.fill();
        // ظل داخلي: خط داخل حدود الوجه بس (نقص النص الخارجي بـ clip)
        ctx.save();
        ctx.clip();
        ctx.lineWidth = 3;
        ctx.strokeStyle = CUBE_INNER_SHADOW;
        ctx.stroke();
        ctx.restore();
        ctx.lineWidth = 1;
        ctx.strokeStyle = EDGE_COLOR;
        ctx.stroke();

        if (v.facing > 0.2) this.drawPips(face, m, v.facing);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    // تحويل affine من مستوى الوجه للشاشة: وحدة وحدة من الشكل، و y لتحت (مثل الـ canvas)
    faceTransform(face, m, k) {
      const e = 0.05;
      const p0 = this.project(mApply(m, face.center));
      const px = this.project(mApply(m, add(face.center, scale(face.right, e))));
      const py = this.project(mApply(m, add(face.center, scale(face.up, e))));
      const { dpr } = this;
      this.ctx.setTransform(
        ((px[0] - p0[0]) / e) * k * dpr,
        ((px[1] - p0[1]) / e) * k * dpr,
        (-(py[0] - p0[0]) / e) * k * dpr,
        (-(py[1] - p0[1]) / e) * k * dpr,
        p0[0] * dpr,
        p0[1] * dpr
      );
    }

    // نقاط الـ d6: دوائر داكنة على الوجه، مائلة معه، بنفس ترتيب النرد الحقيقي
    drawPips(face, m, facing) {
      const { ctx } = this;
      const half = face.inradius;
      const offset = half * PIP_OFFSET;
      const r = half * PIP_RADIUS;
      this.faceTransform(face, m, 1);
      ctx.globalAlpha = Math.min(1, (facing - 0.2) / 0.25);
      for (const cell of PIPS[face.label]) {
        const x = ((cell % 3) - 1) * offset;
        const y = (Math.floor(cell / 3) - 1) * offset;
        // النقطة محفورة: أفتح تحت وأغمق عند الحافة فوق
        const g = ctx.createRadialGradient(x, y + r * 0.35, 0, x, y, r);
        g.addColorStop(0, PIP_LIGHT);
        g.addColorStop(1, PIP_DARK);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // الرقم في وسط الوجه، ومائل معه: نحسب تحويل affine من مستوى الوجه للشاشة
    drawLabel(face, m, facing) {
      const { ctx, shape } = this;
      // تحت 6 و 9 خط صغير يفرّق بينهم (في d10 و d12 و d20)
      const underline = shape.sides >= 10 && (face.label === 6 || face.label === 9);
      const sprite = labelSprite(String(face.label), underline);
      // حجم الرقم (وحدات الشكل لكل وحدة نص): يتسع داخل دائرة نصف قطرها أصغر شوي من أقرب حافة
      const fit = (face.inradius * 0.9) / Math.hypot(sprite.width / 2, sprite.height / 2);
      const k = Math.min(fit, (face.inradius * 1.25) / sprite.height);
      this.faceTransform(face, m, k);

      // الرقم يظهر تدريجياً كل ما الوجه يلف قدّام (بدل ما يطلع فجأة)
      ctx.globalAlpha = Math.min(1, (facing - 0.2) / 0.25);
      // الـ sprite متوسّط حول مركز الوجه
      ctx.drawImage(sprite.canvas, -sprite.drawW / 2, -sprite.drawH / 2, sprite.drawW, sprite.drawH);
      ctx.globalAlpha = 1;
    }

    setLabel(text) {
      this.canvas.setAttribute("aria-label", text);
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
      const ease = cubicBezier(...opts.easing);
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

  // أكبر امتداد للنرد على الشاشة بالبكسل (من المركز)، لنرد نصف قطره radius:
  //  x و y: أفقياً ورأسياً، في كل وضعيات الانتظار (idleRotation) والاستقرار المسموحة
  //  full: أبعد نقطة ممكن يوصلها وهو يدور (رأس على أي اتجاه، مع تكبير المنظور)
  // restSpin: أقصى دوران حول الشاشة بعد الوقوف بالدرجات (يحدده dice.js مع الرمية)
  // dice.js يوزّع النرد بهذي القيم. نجرّب الوضعيات بخطوات صغيرة (أطراف المدى منها)، ونحفظ النتيجة
  const extentCache = new Map();
  function restingExtent(sides, radius, restSpin) {
    const key = `${sides}|${radius}|${restSpin}`;
    if (extentCache.has(key)) return extentCache.get(key);
    const shape = SHAPES[sides];
    const steps = (min, max, n) => Array.from({ length: n + 1 }, (_, i) => min + ((max - min) * i) / n);
    let x = 0;
    let y = 0;
    const measure = (q) => {
      const m = qToMatrix(q);
      for (const vertex of shape.vertices) {
        const p = mApply(m, vertex);
        const s = PERSPECTIVE / (PERSPECTIVE - p[2] * radius);
        x = Math.max(x, Math.abs(p[0]) * radius * s);
        y = Math.max(y, Math.abs(p[1]) * radius * s);
      }
    };
    const quarters = sides === 6 ? [0, 1, 2, 3] : [0];
    for (const face of shape.faces) {
      for (const spin of steps(-restSpin, restSpin, 8))
        for (const quarter of quarters)
          measure(qMul(qAxis(Z_AXIS, (quarter * 90 + spin) * DEG), restRotation(shape, face.label)));
      for (const tilt of steps(...IDLE_TILT, 4))
        for (const direction of steps(-IDLE_TILT_DIRECTION, IDLE_TILT_DIRECTION, 12))
          for (const flip of [0, 180])
            for (const spin of steps(-IDLE_SPIN, IDLE_SPIN, 4))
              for (const quarter of quarters) measure(idleRotation(shape, face.label, tilt, direction + flip, spin, quarter));
    }
    // وهو يدور: أبعد نقطة على كرة نصف قطرها radius بعد المنظور
    let full = radius;
    for (let i = 0; i <= 90; i++) {
      const a = i * DEG;
      full = Math.max(full, (radius * Math.sin(a) * PERSPECTIVE) / (PERSPECTIVE - radius * Math.cos(a)));
    }
    const extent = { x, y, full };
    extentCache.set(key, extent);
    return extent;
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
    restingExtent,
  };
})();
