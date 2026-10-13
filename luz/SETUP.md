# הגדרת שירות ההתראות (בלי טרמינל)

הכול נעשה בדפדפן: באתר של Firebase ובאתר של GitHub. זה לוקח בערך 15 דקות, ועולה 0 ₪ (התוכנית החינמית Spark של Firebase מספיקה, ו-GitHub Actions חינמי במאגר ציבורי).

עד שמסיימים, האתר `reembir.com/5/luz` כבר עובד ומציג את המערכת. רק ההרשמה וההתראות מחכות להגדרה.

---

## 1. יוצרים פרויקט ב-Firebase
1. נכנסים ל-<https://console.firebase.google.com> עם `rb077858@gmail.com`.
2. **Create a project** → נותנים שם (למשל `luz-class`) → אפשר לכבות את Google Analytics → **Create project**.

## 2. מוסיפים אפליקציית Web ומעתיקים את ההגדרות
1. בדף הראשי של הפרויקט לוחצים על הסמל **`</>`** (Web).
2. נותנים כינוי (למשל `luz`), **בלי** לסמן Firebase Hosting → **Register app**.
3. מופיע קוד עם `const firebaseConfig = { ... }`. מעתיקים רק את מה שבתוך הסוגריים המסולסלים (כולל הסוגריים).
4. ב-GitHub נכנסים לקובץ [`luz/firebase-config.js`](firebase-config.js) → לוחצים על העיפרון (Edit).
5. מחליפים את `self.LUZ_FIREBASE_CONFIG = null;` ב:
   ```js
   self.LUZ_FIREBASE_CONFIG = { apiKey: "...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." };
   ```
   (את השורה של `LUZ_VAPID_KEY` ממלאים בשלב 5, אפשר להשאיר את הקובץ פתוח.)

> ה-`apiKey` הזה לא סודי, הוא נועד להיות באתר. מה ששומר על הנתונים הם כללי האבטחה משלב 4.

## 3. מפעילים התחברות
1. בתפריט הצד: **Build → Authentication → Get started**.
2. בלשונית **Sign-in method**:
   - **Anonymous** → Enable → Save (ככה התלמידים נרשמים בלי סיסמה).
   - **Google** → Enable → בוחרים מייל תמיכה → Save (ככה המנהל נכנס).
3. בלשונית **Settings → Authorized domains** → **Add domain** → `reembir.com`.

## 4. יוצרים את מסד הנתונים ומדביקים כללי אבטחה
1. **Build → Firestore Database → Create database**.
2. מיקום: `me-west1 (Tel Aviv)` (או כל מיקום אחר) → **Start in production mode** → Create.
3. בלשונית **Rules** מוחקים את מה שיש, מדביקים את כל התוכן של [`luz/firestore.rules`](firestore.rules) → **Publish**.

הכללים קובעים: כל תלמיד רואה ומשנה רק את עצמו ולא יכול לבטל חסימה, את המערכת רק המנהל משנה, ורק `rb077858@gmail.com` הוא מנהל.

## 5. מפתח להתראות (VAPID)
1. גלגל השיניים ליד **Project Overview** → **Project settings** → לשונית **Cloud Messaging**.
2. למטה, ב-**Web configuration → Web Push certificates** → **Generate key pair**.
3. מעתיקים את המפתח הארוך ומדביקים בקובץ `luz/firebase-config.js`:
   ```js
   self.LUZ_VAPID_KEY = "BExxxxxxxx...";
   ```
4. ב-GitHub: **Commit changes**.

## 6. נותנים לשרת ההתראות הרשאה (Secret ב-GitHub)
השרת ששולח את ההתראות בזמן רץ ב-GitHub Actions. הוא צריך מפתח של Firebase:
1. ב-Firebase: **Project settings → Service accounts → Generate new private key → Generate key**. יורד קובץ JSON.
2. פותחים את הקובץ ב-Notepad (או בכל עורך טקסט) ומעתיקים **את כל התוכן**.
3. ב-GitHub, במאגר `5`: **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: מדביקים את כל התוכן → **Add secret**.
4. מוחקים את הקובץ שירד מהמחשב (הוא סודי).

## 7. מדליקים את השרת
1. במאגר ב-GitHub → לשונית **Actions**. אם מופיעה הודעה שצריך לאשר workflows, מאשרים.
2. בוחרים **luz notifications** → **Run workflow** → Run. מעכשיו הוא ירוץ לבד כל שעה, כל היום.
3. נכנסים ל-`reembir.com/5/luz/admin` → **התחברות עם Google** → לשונית **הגדרות**: צריך להופיע "● פעיל".

## 8. בודקים
1. בטלפון נכנסים ל-`reembir.com/5/luz` → **הרשמה** → ממלאים שם פרטי, שם משפחה ויחידות → מאשרים התראות.
   - **באייפון**: קודם *שיתוף → הוספה למסך הבית*, ונכנסים מהאייקון. רק כך iOS מאפשר התראות מאתר.
2. בדף הניהול → **הודעות** → שולחים הודעת ניסיון לכולם. ההתראה מגיעה תוך כמה שניות.

---

## איך זה עובד
| חלק | איפה |
|---|---|
| האתר לתלמידים | `luz/index.html`, `luz/app.js` |
| דף הניהול | `luz/admin/` (כניסה רק ל-`rb077858@gmail.com`) |
| לוגיקת המערכת (קבוצות, פיצולים, מעברים) | `luz/core.js` |
| המערכת המקורית מהתמונה | `luz/schedule-default.json` |
| שרת ההתראות | `luz/sender/send.mjs` דרך `.github/workflows/luz-notify.yml` |

- **הנתונים ב-Firestore:** `config/schedule` (המערכת), `users/{id}` (שם, משפחה, יחידות, הגדרות התראה, מכשירים, חסימה), `messages/{id}` (הודעות מהמנהל), `sent/*` (רישום פנימי של השרת).
- **קבוצות:** שם משפחה שמתחיל ב-א עד ל → קבוצה 1, השאר → קבוצה 2. אפשר לשנות את האותיות בהגדרות, או לקבוע קבוצה ידנית לתלמיד.
- **ההתראות:** השרת בודק כל 5 שניות. לכל תלמיד הוא מחשב את המערכת האישית שלו (קבוצה + יחידות), ושולח כשמתחיל מעבר שהתלמיד סימן (ברירת מחדל: מהפסקה, ארוחה, תפילה או פעילות לשיעור או לסדר, ומשיעור לשיעור), כמה דקות לפני לפי הבחירה שלו.
- **ריצות חופפות:** כל ריצה נשארת פעילה כשעתיים ומתחילה כל שעה, כך שגם אם GitHub מאחר בהפעלה, תמיד יש ריצה פעילה. כל דקה וכל הודעה נרשמות ב-Firestore כדי שלא יישלחו פעמיים.

## תקלות נפוצות
- **"הדומיין לא מאושר" בכניסת מנהל** → שלב 3.3.
- **בהגדרות כתוב "לא פעיל"** → ב-Actions בודקים שהריצה האחרונה הצליחה ושה-Secret קיים בשם המדויק `FIREBASE_SERVICE_ACCOUNT`.
- **תלמיד לא מקבל התראות** → בדף הניהול, בלשונית תלמידים, רואים אם ההתראות שלו פעילות, חסומות בדפדפן או כבויות.

## אילו כתובות לפתוח בסינון / DNS
אם יש סינון או DNS חוסם, צריך לאפשר את הכתובות האלה, אחרת אי אפשר להירשם להתראות או לקבל אותן:

| כתובת | למה |
|---|---|
| `firebaseinstallations.googleapis.com` | רישום המכשיר ב-Firebase |
| `fcmregistrations.googleapis.com` | קבלת "כתובת" להתראות |
| `fcm.googleapis.com` | שרת ההתראות של גוגל |
| `mtalk.google.com` (גם `mtalk4.google.com`, `alt1-mtalk.google.com` עד `alt8-mtalk.google.com`) | החיבור הקבוע של כרום שדרכו ההתראות מגיעות |
| `android.clients.google.com` | רישום כרום לשירות ההתראות |
| `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com` | המערכת, ההרשמה וההתחברות |
| `www.gstatic.com`, `apis.google.com`, `luz-class.firebaseapp.com`, `accounts.google.com` | ספריות Firebase וכניסת המנהל עם Google |

אם הסינון מאפשר תווים כלליים, הכי פשוט: `*.googleapis.com`, `*.gstatic.com`, `*mtalk.google.com`, `android.clients.google.com`, `*.firebaseapp.com`.
