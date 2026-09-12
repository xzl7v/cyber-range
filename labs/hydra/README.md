# مختبر Hydra عبر SSH

هذا الجزء يضيف تجربة تعليمية لتخمين كلمة مرور حساب تجريبي على هدف SSH داخل مشروع Cyber Range.
يتعلم الطالب عمل قائمة الكلمات وقراءة نتيجة Hydra والتحقق عبر SSH؛ يستخدم المختبر شبكة `isolated-range` دون نشر منفذ على المضيف.

## مكونات الجزء

- `target-hydra-ssh`: هدف SSH داخلي يستمع على المنفذ `22`.
- `hydra-client`: عميل مؤقت يحتوي على Hydra وSSH وقائمة الكلمات.
- `compose.yml`: ملف إضافة يُدمج مع ملف المشروع الرئيسي؛ لا يعمل وحده.
- `passwords.txt`: ست كلمات تجريبية بالترتيب: `password`، `123456`، `welcome`، `qwerty`، `Lab12345`، `admin`.

الحساب التعليمي: المستخدم `trainee` وكلمة المرور `Lab12345`؛ هذه بيانات تدريب مقصودة تُستخدم فقط مع هدف المختبر.
لا تحتاج التجربة الجاهزة إلى تشغيل Kali أو إعداد GPU.

## المتطلبات وحدود التحقق

تحتاج إلى Docker يعمل بحاويات Linux، وإضافة Docker Compose v2، واتصال إنترنت أثناء البناء لتنزيل الصور والحزم.
بعد اكتمال البناء تُجرى التجربة بين الحاويات على الشبكة الداخلية دون حاجة إلى الإنترنت.
نفّذ أوامر المضيف التالية من مجلد `cyber-range` الذي يحتوي على `docker-compose.yml`.
تُفسّر مسارات البناء في ملف الإضافة بالنسبة إلى ملف Compose الرئيسي، لذلك حافظ على ترتيب الملفين.

لم يكن Docker أو WSL مثبتًا على جهاز Windows المحلي وقت إعداد هذا الجزء؛ لذلك لم تُنفّذ تجربة فعلية عليه.
النتائج الموضحة أدناه نتائج متوقعة للتأكد عند التشغيل، وليست مخرجات مرصودة أو ادعاء اجتياز اختبار.

## تشغيل المشرف من المضيف

ابنِ صورتي هذا الجزء:

```sh
docker compose -f docker-compose.yml -f labs/hydra/compose.yml --profile hydra build target-hydra-ssh hydra-client
```

شغّل هدف SSH وحده:

```sh
docker compose -f docker-compose.yml -f labs/hydra/compose.yml --profile hydra up -d target-hydra-ssh
```

تحقق من حالته:

```sh
docker compose -f docker-compose.yml -f labs/hydra/compose.yml --profile hydra ps target-hydra-ssh
```

النتيجة المتوقعة: الهدف يعمل وتصبح صحته `healthy` بعد نجاح فحص SSH؛ ينتظر العميل صحة الهدف قبل بدء التجربة.

## تجربة الطالب الجاهزة

شغّل العميل؛ تُحذف حاويته تلقائيًا بعد انتهاء المحاولة:

```sh
docker compose -f docker-compose.yml -f labs/hydra/compose.yml --profile hydra run --rm hydra-client
```

ينفذ العميل الأمر الافتراضي التالي داخل شبكته:

```sh
hydra -l trainee -P /lab/passwords.txt -t 2 -f -V target-hydra-ssh ssh
```

معاني الخيارات:

| الخيار | وظيفته |
| --- | --- |
| `-l trainee` | تجربة اسم المستخدم المحدد. |
| `-P /lab/passwords.txt` | قراءة كلمات المرور من القائمة التجريبية. |
| `-t 2` | استخدام مهمتين متوازيتين. |
| `-f` | التوقف عند العثور على بيانات صحيحة لهذا الهدف. |
| `-V` | إظهار كل محاولة أثناء التنفيذ. |
| `target-hydra-ssh ssh` | اسم الهدف الداخلي وبروتوكول التجربة. |

النتيجة المتوقعة: العثور على المستخدم `trainee` وكلمة المرور `Lab12345`. قد يختلف ترتيب المحاولات بسبب التوازي؛ انتهاء القائمة وحده ليس دليل نجاح.

## التحقق من النتيجة عبر SSH

استخدم عميل SSH الموجود في صورة العميل:

```sh
docker compose -f docker-compose.yml -f labs/hydra/compose.yml --profile hydra run --rm --entrypoint ssh hydra-client trainee@target-hydra-ssh 'whoami'
```

عند أول اتصال بهذا الهدف التجريبي اكتب `yes` لقبول مفتاح المضيف، ثم اكتب `Lab12345` يدويًا عند طلب كلمة المرور.
لا تظهر أحرف كلمة المرور أثناء كتابتها. النتيجة المتوقعة للأمر هي `trainee` ثم إغلاق الاتصال.

## متابعة سجل الهدف

من نافذة ثانية على المضيف:

```sh
docker compose -f docker-compose.yml -f labs/hydra/compose.yml --profile hydra logs --tail 50 -f target-hydra-ssh
```

المتوقع ظهور محاولات فاشلة ثم دخول ناجح، واتصالات إضافية لفحص الصحة. ينهي `Ctrl+C` متابعة السجل ويبقى الهدف يعمل.

## العرض المقترح

1. اعرض حدود الشبكة الداخلية والحساب التجريبي وقائمة الكلمات القصيرة.
2. شغّل الهدف وتأكد من صحته، ثم افتح سجل SSH في نافذة ثانية.
3. شغّل عميل Hydra واشرح خياراته والنتيجة التي يعرضها.
4. نفّذ التحقق عبر SSH، وقارن الدخول الناجح بما ظهر في السجل.
5. وضّح أن نتيجة التجربة تخص هذا الحساب والهدف وقائمة الكلمات فقط، ثم أوقف الهدف.

## الإيقاف وإعادة الضبط

لإيقاف هدف هذا الجزء وحذف حاويته فقط:

```sh
docker compose -f docker-compose.yml -f labs/hydra/compose.yml --profile hydra stop target-hydra-ssh
docker compose -f docker-compose.yml -f labs/hydra/compose.yml --profile hydra rm -f target-hydra-ssh
```

لإعادة إنشائه بحالة نظيفة وكلمة المرور الثابتة `Lab12345`:

```sh
docker compose -f docker-compose.yml -f labs/hydra/compose.yml --profile hydra up -d --force-recreate target-hydra-ssh
```

تستهدف هذه الأوامر مختبر Hydra وحده. لا تستخدم الإيقاف الشامل للمشروع أثناء عرض جزء الفريق.

## استخدام Kali الموجود اختياريًا

إذا كانت حاوية `student-node` تعمل وكان أمر `hydra` متاحًا فيها، انسخ القائمة من المضيف:

```sh
docker cp labs/hydra/passwords.txt student-node:/tmp/hydra-passwords.txt
```

ثم من طرفية Kali داخل جلسة الطالب:

```sh
hydra -l trainee -P /tmp/hydra-passwords.txt -t 2 -f -V target-hydra-ssh ssh
```

إذا لم تكن Hydra مثبتة، استخدم العميل الجاهز أعلاه؛ لا يحتاج العرض إلى تثبيت حزم داخل حاوية Kali المعزولة.

## المراجع

- [مشروع THC Hydra الرسمي وخيارات الاستخدام](https://github.com/vanhauser-thc/thc-hydra)
- [توثيق Docker لدمج ملفات Compose ومساراتها](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)
