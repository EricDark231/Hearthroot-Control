# Hearthroot Control 🌿

Root-module WebUI for Hearthroot Kernel on POCO X7 Pro (`rodin`), with an optional LSPosed companion for Xiaomi Parts. The **Companion source is in `companion-src/`** in this same repository.

## Profiles

| Profile | CPU governor | I/O scheduler | Xiaomi Parts (if available) |
| --- | --- | --- | --- |
| Native | `sugov_ext` | `none` | Normal |
| Balanced | `schedutil` | `kyber` | Normal |
| Battery Saver | `conservative` | `none` | Economy |
| Performance | `performance` | `mq-deadline` | Boost |
| Experimental | Manual | Manual | None / Normal / Economy / Boost |

Extreme and thermal-protection bypass are intentionally excluded. Kernel CPU/I/O controls work without Companion or LSPosed. Options depend on the running kernel.

## Installation

Install `Hearthroot-Control-v0.8.7-alpha.zip` in a compatible BakaSU/KernelSU root manager and reboot. At the installer prompt, **Volume Up** installs/updates the bundled Companion APK, while **Volume Down** skips it and preserves an existing installation. If installed, enable Companion in modern LSPosed and scope it to Xiaomi Parts (`com.xiaomi.settings`); reboot to load the hook. The bridge is optional and checked live when applying profiles.

**Apply on Boot** can restore a saved profile after startup. Battery Saver restoration with Xiaomi Parts Economy was verified on the development POCO X7 Pro, but compatibility is not guaranteed on other devices or ROMs.

## Building Companion from this repository

```sh
cd companion-src
gradle --no-daemon :app:assembleDebug
```

The build output is `companion-src/app/build/outputs/apk/debug/app-debug.apk`. Preserve a stable signing certificate for updates. Never commit keystores or local Android build outputs.

## Credits

Hearthroot Control and Companion: EricDark231. Hearthroot Kernel builds upon work from [omajili-manbu/Xiaomi_Rodin_Kernel_Enhance](https://github.com/omajili-manbu/Xiaomi_Rodin_Kernel_Enhance) and its contributors. Credits to the BakaSU, KernelSU, LSPosed/libxposed, Xiaomi Parts and ROM/device maintainers for their respective components. Respect all upstream licenses.
