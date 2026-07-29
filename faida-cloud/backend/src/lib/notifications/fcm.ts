import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

function app() {
  if (getApps().length) return getApps()[0];
  const json = JSON.parse(Buffer.from(process.env.FCM_SERVICE_ACCOUNT_B64!, "base64").toString());
  return initializeApp({ credential: cert(json) });
}

export async function sendPush(token: string, title: string, body: string, data?: Record<string, string>) {
  return getMessaging(app()).send({ token, notification: { title, body }, data });
}
