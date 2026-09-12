import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
export function createPhoneAuth(firebaseApp, recaptchaElementId){const auth=getAuth(firebaseApp);let confirmation=null;const verifier=new RecaptchaVerifier(auth,recaptchaElementId,{size:'invisible'});return {
 async send(phone){confirmation=await signInWithPhoneNumber(auth,phone,verifier);return true;},
 async verify(code){if(!confirmation)throw new Error('OTP_NOT_SENT');return confirmation.confirm(String(code).trim());},
 reset(){confirmation=null;verifier.clear();}
};}
