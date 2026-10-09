# Hearthroot Companion v0.1 (API 101)

Prototipo de diagnóstico para LSPosed moderno en Android 17 y Xiaomi Parts (`com.xiaomi.settings`).

## Estado de esta versión

- No cambia los perfiles, governors ni las frecuencias de CPU.
- No abre puertos, sockets, broadcasts ni servicios exportados.
- Solo se carga con alcance de `com.xiaomi.settings`, registra el proceso y comprueba la existencia de dos clases DEX.
- No forma parte todavía del ZIP de Hearthroot Control.

## Compilación por GitHub Actions

1. Crear un repositorio vacío para `Hearthroot-Companion`.
2. Subir el contenido de esta carpeta **a la raíz del repositorio**, incluida `.github/workflows/build-companion.yml`.
3. En **Actions** elegir **Build Hearthroot Companion (API 101)** y luego **Run workflow**.
4. Descargar el artefacto `Hearthroot-Companion-v0.1-test` con `app-debug.apk`.
5. Si GitHub Actions informa de un error de compilación, conservar el log y compartirlo para corregirlo. No se ha compilado ni probado en un teléfono en el entorno de generación.

## Compilación local alternativa

Requiere JDK 17, Gradle 8.11.1 y Android SDK con platform android-36. Una vez instalados:

```bash
gradle --no-daemon :app:assembleDebug
```

La APK quedará en `app/build/outputs/apk/debug/app-debug.apk`.

## Instalación y comprobación

1. Instalar `app-debug.apk` con el gestor de paquetes de Android; no hace falta flashear otra cosa.
2. Abrir LSPosed 2.2.1 → Módulos → **Hearthroot Companion**.
3. Habilitar el módulo y seleccionar **únicamente Xiaomi Parts (`com.xiaomi.settings`)** como alcance.
4. Reiniciar Android para garantizar la recarga del proceso, o cerrar y volver a abrir Xiaomi Parts si el gestor lo permite de manera segura.
5. Entrar a Xiaomi Parts/Control de CPU para que su proceso se inicie.
6. En Termux con `su`:

```sh
logcat -d -s HearthrootCompanion:I '*:S' | tail -60
```

Buscamos `onModuleLoaded`, `onPackageReady`, `FOUND com.xiaomi.settings.cpu.CpuControlManager`, `FOUND com.xiaomi.settings.cpu.CpuProfile` y `probe complete`.

**IMPORTANTE:** Esta es una comprobación de inyección/carga de clases, no una prueba de selección de perfil. Cuando esté confirmada, diseñaremos la comunicación segura entre el root module y el proceso de Xiaomi Parts.

## Compatibilidad

- API moderna 101: `io.github.libxposed:api:101.0.1` como `compileOnly`.
- Sin API Legacy, sin `assets/xposed_init`.
- No se requiere acceso al proceso `system_server`.
- `targetSdk=35` para compilar contra Android SDK 36 y ejecutarse en Android 17; el OS del teléfono sigue siendo API 37.
