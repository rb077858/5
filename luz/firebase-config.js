// ⚙️ הגדרות Firebase — זה הקובץ היחיד שצריך לערוך (אפשר ישירות באתר של GitHub).
// ההסבר המלא נמצא ב-SETUP.md.
//
// 1) הדביקו כאן את האובייקט firebaseConfig מתוך Firebase Console → Project settings → Your apps.
// 2) הדביקו את ה-Key pair מתוך Project settings → Cloud Messaging → Web Push certificates.
self.LUZ_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBb6kmJMYClEq1FlBZSKtvrYHaG5GlKV4o",
  authDomain: "luz-class.firebaseapp.com",
  projectId: "luz-class",
  storageBucket: "luz-class.firebasestorage.app",
  messagingSenderId: "1035710781423",
  appId: "1:1035710781423:web:c50b9f5a7a6e62fd91881a"
};
/* לדוגמה:
self.LUZ_FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "my-class.firebaseapp.com",
  projectId: "my-class",
  storageBucket: "my-class.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
*/
self.LUZ_VAPID_KEY = "BLTifO14HPfVbo7UMx8V_4Chh4NMMqQUIhst_9NHwROE-hNcOqVhrl9oSX6wRMruZD4MQhpQv4QM93m12pKRens";
