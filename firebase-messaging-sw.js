importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:'AIzaSyASl5jV5mLaDh8CoeeofV7ftVJ3gaog64E',authDomain:'karwa0.firebaseapp.com',projectId:'karwa0',storageBucket:'karwa0.firebasestorage.app',messagingSenderId:'485451054622',appId:'1:485451054622:web:ce9b0e2ff2280870a8780f'});
firebase.messaging().onBackgroundMessage(payload=>{const n=payload.notification||{};self.registration.showNotification(n.title||'كروة',{body:n.body||'لديك تحديث جديد',icon:'./favicon.ico',data:payload.data||{}});});
