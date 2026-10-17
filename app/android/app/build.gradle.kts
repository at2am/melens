import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// The release upload key stays outside the repository. MELENS_ANDROID_KEY_PROPERTIES names a
// key.properties with storeFile (relative to that file), storePassword, keyAlias and keyPassword
// (.github/release/README.md). Without it a release build is signed with the debug key, so
// `flutter run --release` still works; app/e2e/build_mobile_release.py refuses such a bundle.
val uploadKey = Properties()
System.getenv("MELENS_ANDROID_KEY_PROPERTIES")?.takeIf { it.isNotEmpty() }?.let { path ->
    val keyFile = file(path)
    keyFile.inputStream().use { uploadKey.load(it) }
    uploadKey.setProperty("storeFile", keyFile.parentFile.resolve(uploadKey.getProperty("storeFile")).path)
}
val hasUploadKey = !uploadKey.isEmpty

android {
    namespace = "com.at2am.melens"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.at2am.melens"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasUploadKey) {
            create("upload") {
                storeFile = file(uploadKey.getProperty("storeFile"))
                storePassword = uploadKey.getProperty("storePassword")
                keyAlias = uploadKey.getProperty("keyAlias")
                keyPassword = uploadKey.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(if (hasUploadKey) "upload" else "debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
