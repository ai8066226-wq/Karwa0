import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";
export async function enableKarwaPush(firebaseApp, vapidKey, onForegroundMessage=()=>{}) {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) throw new Error('PUSH_UNSUPPORTED');
  const permission=await Notification.requestPermission(); if(permission!=='granted') throw new Error('PUSH_DENIED');
  const registration=await navigator.serviceWorker.register('./firebase-messaging-sw.js');
  const messaging=getMessaging(firebaseApp); const token=await getToken(messaging,{vapidKey,serviceWorkerRegistration:registration});
  if(!token) throw new Error('NO_PUSH_TOKEN'); await httpsCallable(getFunctions(firebaseApp),'registerPushToken')({token});
  onMessage(messaging,payload=>onForegroundMessage(payload)); return token;
}
