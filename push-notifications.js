import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, getFirestore, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

export async function enableKarwaPush(firebaseApp, vapidKey, onForegroundMessage=()=>{}) {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) throw new Error("PUSH_UNSUPPORTED");
  const permission=await Notification.requestPermission(); if(permission!=="granted") throw new Error("PUSH_DENIED");
  const registration=await navigator.serviceWorker.register("./firebase-messaging-sw.js");
  const messaging=getMessaging(firebaseApp);
  const token=await getToken(messaging,{vapidKey,serviceWorkerRegistration:registration});
  if(!token) throw new Error("NO_PUSH_TOKEN");
  const user=getAuth(firebaseApp).currentUser;
  if(user){
    const id=`web_${token.slice(-36).replace(/[^a-zA-Z0-9_-]/g,"_")}`;
    await setDoc(doc(getFirestore(firebaseApp),"users",user.uid,"pushTokens",id),{token,platform:"web",app:"karwa",updatedAt:serverTimestamp()},{merge:true});
  }
  onMessage(messaging,payload=>onForegroundMessage(payload));
  return token;
}
