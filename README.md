# دوّر — dawwir.net

موقع أدوات اختيار عشوائي بالعربي: عجلة الأسماء، عجلات جاهزة، اختيار فائز السحب، تقسيم الفرق، النرد، العملة، والرقم العشوائي.
موقع static بالكامل (HTML + CSS + JavaScript عادي)، بدون framework وبدون سيرفر وبدون build step، وكل الأدوات تشتغل داخل المتصفح.

---

## وش تستبدل قبل النشر

### 1) البريد `contact@dawwir.net` (لو غيّرته)

موجود في `contact.html` و `privacy.html` فقط. لو تبي تغيّره، استبدله بأمر واحد من **Git Bash** داخل مجلد المشروع:

```bash
grep -rl "contact@dawwir\.net" --include=*.html . | xargs sed -i 's/contact@dawwir\.net/hello@example.com/g'
```

غيّر `hello@example.com` لبريدك الجديد، وتأكد بعدها:

```bash
grep -rn "contact@dawwir\.net" --include=*.html . || echo "تم الاستبدال"
```

### 2) الدومين `dawwir.net` (لو غيّرته)

الدومين موجود في: الـ canonical و Open Graph و JSON-LD في كل صفحة، و `sitemap.xml`، و `robots.txt`، وفي نص النسخ داخل `assets/js/giveaway.js` و `assets/js/teams.js`، وفي الـ footer.

```bash
grep -rl "dawwir\.net" --include=*.html --include=*.xml --include=*.txt --include=*.js . | xargs sed -i 's/dawwir\.net/newdomain.com/g'
```

صورة المشاركة `assets/og-image.png` مكتوب فيها الدومين داخل الصورة نفسها، فلازم تسوي لها صورة جديدة لو غيّرت الدومين.

### 3) اسم الموقع «دوّر» (لو غيّرته)

**لا تستبدله بأمر واحد**، لأن كلمة «دوّر» مستخدمة كمان كفعل في زر العجلة («دوّر» و«دوّر مرة ثانية») وفي النصوص. الأماكن اللي فيها الاسم:

- آخر كل `<title>` بعد العلامة `|`، و `og:site_name`، و `publisher` في JSON-LD.
- الشعار `<a class="logo">` في الـ header، والـ footer، في كل صفحة.
- صفحة `about.html` (عبارة «فريق دوّر»)، وصورة المشاركة `assets/og-image.png`.
- نص المشاركة في `assets/js/wheel.js` (`عجلة دوّر`)، وفي `giveaway.js` و `teams.js`.

---

## تجربة الموقع محلياً

روابط الموقع نظيفة بدون `.html` (مثل `/tools/dice`) وتبدأ من الجذر `/`، فلازم سيرفر يخدم الروابط النظيفة. **Live Server ما يخدمها** (يطلع 404)، فاستخدم `serve` بدله (يحتاج Node.js):

1. افتح Terminal داخل مجلد المشروع، وشغّل:

```bash
npx serve .
```

2. افتح الرابط اللي يطلع (عادةً `http://localhost:3000`). الملف `serve.json` في جذر المشروع (`{"cleanUrls": true}`) هو اللي يخلي `/tools/dice` يفتح `tools/dice.html`.
3. للتجربة على الجوال: خلّ الجوال والكمبيوتر على نفس الـ Wi-Fi، واكتب في متصفح الجوال `http://<IP الكمبيوتر>:3000` (الـ IP من أمر `ipconfig`، و `serve` يطبعه كمان تحت **Network**).

ملاحظة: فتح الصفحات كملفات مباشرة (`file://`) ما يشتغل صح، لأن الروابط تبدأ بـ `/`.

---

## النشر على GitHub Pages

### الخطوة 1: رفع الملفات

1. سوّ repository جديد على GitHub (Public).
2. ارفع **محتوى** مجلد المشروع للفرع `main`، بحيث يكون `index.html` في جذر الـ repository مباشرة (مو داخل مجلد).

```bash
git init
git add .
git commit -m "أول نسخة من الموقع"
git branch -M main
git remote add origin https://github.com/<اسم-الحساب>/<اسم-الريبو>.git
git push -u origin main
```

### الخطوة 2: تفعيل Pages

1. في الـ repository: **Settings ← Pages**.
2. تحت **Build and deployment** اختر **Deploy from a branch**، ثم الفرع `main` والمجلد `/ (root)`، واضغط **Save**.
3. بعد دقيقة أو دقيقتين يطلع رابط مثل `https://<اسم-الحساب>.github.io/<اسم-الريبو>/`. الروابط الداخلية تبدأ من جذر الدومين (`/tools/dice`)، فما تشتغل صح إلا بعد ربط الدومين في الخطوة 3.

**الروابط النظيفة:** GitHub Pages يخدم الصفحات بدون `.html` تلقائياً (`/tools/dice` يفتح `tools/dice.html`)، فما نغيّر أسماء الملفات. كل الروابط والـ canonical والـ sitemap مكتوبة بالصيغة النظيفة، ولو أحد فتح الرابط القديم بـ `.html` سكربت صغير في `<head>` يشيل `.html` من شريط العنوان بدون إعادة تحميل.

### الخطوة 3: ربط الدومين dawwir.net

1. في نفس صفحة **Pages**، اكتب `dawwir.net` في خانة **Custom domain** واضغط **Save** (GitHub بيضيف ملف `CNAME` تلقائياً).
2. في لوحة التحكم عند مزوّد الدومين، أضف سجلات DNS هذي:

| النوع | الاسم | القيمة |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `<اسم-الحساب>.github.io` |

3. انتظر لين يتفعّل الـ DNS (من دقائق لين 24 ساعة)، وبعدها فعّل **Enforce HTTPS** في صفحة Pages.
4. افتح `https://dawwir.net` وتأكد إن كل الأدوات تشتغل (مثلاً `https://dawwir.net/tools/dice`)، وإن `https://dawwir.net/sitemap.xml` يفتح.

---

## بعد النشر

### Google Search Console

1. أضف الموقع في [Google Search Console](https://search.google.com/search-console) وأثبت ملكية الدومين (عن طريق سجل TXT في DNS).
2. من **Sitemaps** أرسل الرابط `https://dawwir.net/sitemap.xml`.

### Google AdSense

1. قدّم على AdSense بعد ما يكون الموقع منشور ومفتوح على الدومين.
2. AdSense بيعطيك كود `<script>` تحطه داخل `<head>` في **كل الصفحات**.
3. سوّ ملف `ads.txt` في جذر الموقع فيه السطر اللي يعطيك AdSense (يبدأ بـ `google.com, pub-...`).
4. بعد القبول، حط كود الوحدات الإعلانية داخل عناصر `<div class="ad-slot">` الموجودة. المساحات الفاضية مخفية حالياً بقاعدة `.ad-slot:empty { display: none; }` في `style.css`، وأول ما تحط الكود داخل الـ div ترجع المساحة تظهر تلقائياً بنفس الارتفاع المحجوز (عشان ما يصير layout shift)، وما تحتاج تعدّل الـ CSS. أي div تخليه بدون إعلان خلّه فاضي تماماً (بدون مسافات أو أسطر داخله) عشان يبقى مخفي.
5. فعّل رسالة الموافقة على الكوكيز من **AdSense ← Privacy & messaging** للزوار من أوروبا والمملكة المتحدة.
6. لو تغيّرت طريقة الإعلانات، حدّث `privacy.html` وتاريخ «آخر تحديث» فيها.

---

## هيكل المشروع

```
index.html                 عجلة الأسماء (الصفحة الرئيسية)
tools/ready-wheels.html    صفحة العجلات الجاهزة
tools/wheels/*.html        5 عجلات جاهزة (كلها تستخدم assets/js/wheel.js)
tools/*.html               اختيار فائز، تقسيم فرق، نرد، عملة، رقم عشوائي
about.html, contact.html, privacy.html, 404.html
robots.txt, sitemap.xml, favicon.ico
assets/css/style.css       ملف التنسيق الوحيد
assets/js/common.js        دوال مشتركة (العشوائية، النسخ، الرسائل)
assets/js/*.js             ملف لكل أداة
assets/fonts/              خط Cairo محلي (رخصة OFL في OFL.txt)
```

لو أضفت صفحة جديدة: انسخ الـ header والـ footer من صفحة بنفس العمق، وأضفها لقائمة الروابط في كل الصفحات، ولـ `sitemap.xml`.
