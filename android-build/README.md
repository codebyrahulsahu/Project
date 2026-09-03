# Arena Lite → Android APK

`../arena-app` (PWA) ko **Capacitor** se native Android app mein wrap karta hai.
`android/` folder generated hai (git mein nahi) — `setup-android.sh` usse kabhi bhi dobara bana deta hai.

## Sabse aasaan: GitHub Actions se APK lo (koi install nahi chahiye)

`main` pe push hote hi workflow **Build Android APK** chalta hai:

- **Actions** tab → latest run → *Artifacts* → `arena-lite-debug-apk` (zip mein `.apk`)
- ya **Releases** page → `apk-N` release → `.apk` seedha download

Manual trigger: Actions → *Build Android APK* → **Run workflow**.

## Laptop pe build karna

Chahiye: Node 18+, JDK 17/21, Android SDK (Android Studio se aata hai; `ANDROID_HOME` set ho).

```bash
cd android-build
./setup-android.sh                 # npm install + cap add/sync + branding overlay
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Phone pe: `adb install -r app/build/outputs/apk/debug/app-debug.apk`
ya APK file phone pe bhej ke open karo (Unknown sources allow karna padega).

Android Studio se: `npx cap open android` → Run ▶.

## Web code badla? APK refresh:

```bash
cd android-build && npx cap sync android && cd android && ./gradlew assembleDebug
```

## Release (Play Store / signed) APK

1. Keystore banao: `keytool -genkey -v -keystore arena.keystore -alias arena -keyalg RSA -keysize 2048 -validity 10000`
2. `android/app/build.gradle` mein `signingConfigs.release` add karo (Capacitor docs: *Deploying to Google Play*)
3. `./gradlew assembleRelease` (APK) ya `bundleRelease` (AAB, Play Store ke liye)

Workflow abhi **debug** APK banata hai — install/test ke liye kaafi hai, Play Store ke liye signing chahiye.

## Files

| File | Kaam |
|---|---|
| `capacitor.config.json` | appId `com.arenalite.app`, name, `webDir: ../arena-app` |
| `package.json` | Capacitor deps + scripts |
| `setup-android.sh` | android/ generate + sync + overlay apply |
| `overlay/` | Hamari branding: app name, dark theme (no white flash), adaptive icon, splash |
| `.github/workflows/android-apk.yml` | CI build + artifact + release |

## Notes

- Agent mode ke web tools (DuckDuckGo/Wikipedia/jina) APK ke andar bhi `fetch` se hi chalte hain — `INTERNET` permission template mein already hai.
- WebView ka origin `https://localhost` hota hai (`androidScheme: https`) — localStorage/Service Worker theek chalte hain, API keys device pe hi rehti hain.
- Back button: Capacitor default WebView history use karta hai; app single-page hai toh back se app exit hota hai (chaaho toh `@capacitor/app` se custom handling add kar sakte ho).
