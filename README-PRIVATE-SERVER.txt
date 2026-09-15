Karwa Phase 51 private backend + admin portal.

IMPORTANT
- The administration UI remains OUTSIDE the Android APK.
- Only a Firebase user whose users/{uid}.role == "admin" can open/use admin operations.
- deleteAccountCompletely is a privileged Cloud Function using Firebase Admin SDK. It deletes Auth + linked Firestore/Storage data and refuses to delete the current admin or any admin-role account.

Deploy from this server folder (after Firebase CLI login and project selection):
  cd functions && npm install && cd ..
  firebase deploy --only functions:deleteAccountCompletely,firestore:rules,storage,hosting

If you already host the admin portal elsewhere, deploy only:
  firebase deploy --only functions:deleteAccountCompletely,firestore:rules,storage
and copy private-admin/ to your existing private admin hosting location.
