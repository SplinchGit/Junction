type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

function envValue(key: keyof ImportMetaEnv): string {
  return (import.meta.env[key] ?? "").toString();
}

const firebase: FirebaseConfig = {
  apiKey: envValue("VITE_FIREBASE_API_KEY"),
  authDomain: envValue("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: envValue("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: envValue("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: envValue("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: envValue("VITE_FIREBASE_APP_ID"),
  measurementId: envValue("VITE_FIREBASE_MEASUREMENT_ID") || undefined,
};

const firebaseMissing = [
  ["VITE_FIREBASE_API_KEY", firebase.apiKey],
  ["VITE_FIREBASE_AUTH_DOMAIN", firebase.authDomain],
  ["VITE_FIREBASE_PROJECT_ID", firebase.projectId],
  ["VITE_FIREBASE_STORAGE_BUCKET", firebase.storageBucket],
  ["VITE_FIREBASE_MESSAGING_SENDER_ID", firebase.messagingSenderId],
  ["VITE_FIREBASE_APP_ID", firebase.appId],
]
  .filter(([, value]) => !value)
  .map(([key]) => key);

const realtimeEndpoint = envValue("VITE_REALTIME_ENDPOINT");

export const config = {
  firebase,
  firebaseMissing,
  hasFirebaseConfig: firebaseMissing.length === 0,
  realtimeEndpoint,
  isDev: import.meta.env.DEV,
};
