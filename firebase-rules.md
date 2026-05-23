# Firebase Rules

把下面规则里的 `admin@xiaoyu.space` 换成你的真实管理者邮箱。

## Firestore Rules

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /footprints/{docId} {
      allow read, write: if request.auth != null
        && request.auth.token.email == "admin@xiaoyu.space";
    }
  }
}
```

## Storage Rules

```js
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    match /footprint-images/{allPaths=**} {
      allow read, write: if request.auth != null
        && request.auth.token.email == "admin@xiaoyu.space";
    }
  }
}
```
