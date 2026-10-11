package dev.hearthroot.companion;

import android.app.Application;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.util.Log;
import android.os.SystemClock;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

import io.github.libxposed.api.XposedModule;

/**
 * Hearthroot Companion v0.3: Modern Xposed API 101.
 * Runs only in Xiaomi Parts, with the scope provided in META-INF/xposed.
 * Uses Xiaomi Parts' own CpuControlManager; never writes directly to sysfs.
 */
public final class HearthrootModule extends XposedModule {
    private static final String TAG = "HearthrootCompanion";
    private static final String TARGET = "com.xiaomi.settings";
    private static final String COMPANION = "dev.hearthroot.companion";
    private static final String MANAGER = "com.xiaomi.settings.cpu.CpuControlManager";
    private static final String PROFILE = "com.xiaomi.settings.cpu.CpuProfile";
    private static final String ACTION = COMPANION + ".action.CPU_CONTROL_V03";
    private static final String PERMISSION = COMPANION + ".permission.CONTROL";
    private static final String EXTRA_REPLY = "reply";
    private static final String EXTRA_COMMAND = "command";
    private static final String EXTRA_PROFILE = "profile";
    private static final String EXTRA_SENT_AT = "sent_at_elapsed";
    private static final long SET_MAX_AGE_MS = 5000L;

    private ClassLoader targetLoader;
    private BroadcastReceiver bridgeReceiver;
    private volatile boolean managerClassFound;
    private volatile boolean profileClassFound;
    private volatile boolean selectProfileHookInstalled;
    private volatile boolean attachHookInstalled;
    private volatile ProfileEvent lastInterceptedEvent;

    private static final class ProfileEvent {
        final String profile;
        final long elapsed;

        ProfileEvent(String profile, long elapsed) {
            this.profile = profile;
            this.elapsed = elapsed;
        }
    }

    public HearthrootModule() {
        super();
    }

    private void report(String message) {
        Log.i(TAG, message);
        log(Log.INFO, TAG, message);
    }

    @Override
    public void onModuleLoaded(ModuleLoadedParam param) {
        report("onModuleLoaded process=" + param.getProcessName() +
                " api=" + getApiVersion());
    }

    @Override
    public void onPackageReady(PackageReadyParam param) {
        if (!TARGET.equals(param.getPackageName())) return;
        report("onPackageReady package=" + param.getPackageName());
        targetLoader = param.getClassLoader();
        checkClass(MANAGER);
        checkClass(PROFILE);
        installTrace();
        installBridgeOnApplicationAttach();
    }

    private void checkClass(String name) {
        boolean found = false;

        try {
            Class<?> resolved = Class.forName(name, false, targetLoader);
            found = true;
            report("FOUND " + resolved.getName());
        } catch (Throwable t) {
            report("MISSING " + name + " " + t.getClass().getSimpleName());
        }

        if (MANAGER.equals(name)) {
            managerClassFound = found;
        } else if (PROFILE.equals(name)) {
            profileClassFound = found;
        }
    }

    private void installTrace() {
        try {
            Class<?> manager = Class.forName(MANAGER, false, targetLoader);
            Class<?> profile = Class.forName(PROFILE, false, targetLoader);
            Method method = manager.getDeclaredMethod("selectProfile", profile);
            method.setAccessible(true);
            hook(method)
                .setExceptionMode(ExceptionMode.PROTECTIVE)
                .intercept(chain -> {
                    Object selected = chain.getArg(0);
                    Object result = chain.proceed();

                    String profileName = String.valueOf(selected);
                    lastInterceptedEvent = new ProfileEvent(
                            profileName, SystemClock.elapsedRealtime());

                    report("PROFILE SELECTED: " + profileName);
                    return result;
                });
            selectProfileHookInstalled = true;
            report("HOOK INSTALLED: CpuControlManager.selectProfile");
        } catch (Throwable e) {
            report("HOOK FAILED: " + e);
        }
    }

    private void installBridgeOnApplicationAttach() {
        try {
            Method attach = Application.class.getDeclaredMethod("attach", Context.class);
            attach.setAccessible(true);
            hook(attach)
                .setExceptionMode(ExceptionMode.PROTECTIVE)
                .intercept(chain -> {
                    Object result = chain.proceed();
                    Context context = (Context) chain.getArg(0);
                    if (TARGET.equals(context.getPackageName())) {
                        try {
                            ensureBridge(context);
                         } catch (Throwable t) {
                            report("BRIDGE FAILED: " + t);
                         }
                    }
                    return result;
                });
            attachHookInstalled = true;
            report("HOOK INSTALLED: Application.attach");
        } catch (Throwable t) {
            report("BRIDGE HOOK FAILED: " + t);
        }
    }

    private synchronized void ensureBridge(Context context) {
        if (bridgeReceiver != null) return;
        IntentFilter filter = new IntentFilter(ACTION);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ignored, Intent intent) {
                report("BRIDGE RX: broadcast received");
                // Defense in depth: validate the real Android sender UID, not extras.
                int expectedUid;
                try {
                    expectedUid = context.getPackageManager().getPackageUid(COMPANION, 0);
                } catch (Exception e) {
                    report("BRIDGE REFUSED: companion package unavailable");
                    return;
                }
                // La protección primaria es el permiso de firma exigido por
                // registerReceiver(..., PERMISSION, ..., RECEIVER_EXPORTED).
                // Android puede devolver INVALID_UID (-1) para broadcasts:
                // no equivale a un remitente incorrecto.
                if (context.getPackageManager().checkPermission(PERMISSION, COMPANION)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    report("BRIDGE REFUSED: companion missing signature permission");
                    return;
                }
                int senderUid = getSentFromUid();
                if (senderUid != android.os.Process.INVALID_UID && senderUid != expectedUid) {
                    report("BRIDGE REFUSED: sender UID mismatch (" + senderUid + ")");
                    return;
                }
                if (senderUid == android.os.Process.INVALID_UID) {
                    report("BRIDGE AUTH: sender UID unavailable; signature permission enforced");
                }
                ResultReceiver reply;
                try {
                    reply = intent.getParcelableExtra(EXTRA_REPLY, ResultReceiver.class);
                } catch (RuntimeException e) {
                    report("BRIDGE REFUSED: invalid reply");
                    return;
                }
                if (reply == null) return;
                try {
                    String command = intent.getStringExtra(EXTRA_COMMAND);
                    if ("STATUS".equals(command)) {
                        report("BRIDGE STATUS: processing");
                        sendStatus(reply, context);
                    } else if ("QUERY".equals(command)) {
                        report("BRIDGE QUERY: processing");
                        String current = getSelectedProfile(context);
                        report("BRIDGE QUERY: profile=" + current);
                        send(reply, 0, current, "Perfil declarado por Xiaomi Parts");
                        report("BRIDGE QUERY: reply sent");
                    } else if ("SET".equals(command)) {
                        report("BRIDGE SET: processing");
                        long sentAt = intent.getLongExtra(EXTRA_SENT_AT, -1L);
                        long now = SystemClock.elapsedRealtime();

                        if (sentAt < 0 || sentAt > now
                                || now - sentAt > SET_MAX_AGE_MS) {
                            report("BRIDGE SET REJECTED: expired or invalid request");
                            send(reply, 1, null, "Solicitud SET caducada");
                            return;
                        }
                        String requested = intent.getStringExtra(EXTRA_PROFILE);
                        // Allow only validated non-EXTREME modes. Never modify thermal controls.
                        if (!"NORMAL".equals(requested)
                                && !"ECONOMY".equals(requested)
                                && !"BOOST".equals(requested)) {
                            send(reply, 1, null, "Modo no permitido por Hearthroot Companion");
                            return;
                        }
                        selectProfile(context, requested);
                        String actual = getSelectedProfile(context);
                        if (!requested.equals(actual)) {
                            send(reply, 1, actual, "Xiaomi Parts no confirmó el perfil solicitado");
                            return;
                        }
                        report("BRIDGE SET OK: " + actual);
                        send(reply, 0, actual, "Perfil aceptado por Xiaomi Parts");
                    } else {
                        send(reply, 1, null, "Comando no reconocido");
                    }
                } catch (Throwable t) {
                    report("BRIDGE ERROR: " + t);
                    send(reply, 1, null, t.getClass().getSimpleName());
                }
            }
        };
        // Only senders holding Companion's signature permission can reach us.
        context.registerReceiver(
                receiver, filter, PERMISSION,
                new Handler(Looper.getMainLooper()), Context.RECEIVER_EXPORTED);
        bridgeReceiver = receiver;
        report("BRIDGE READY: signed requests, Xiaomi Parts process");
    }

    private Object newManager(Context context) throws Exception {
        Class<?> manager = Class.forName(MANAGER, true, targetLoader);
        Constructor<?> constructor = manager.getDeclaredConstructor(Context.class);
        constructor.setAccessible(true);
        return constructor.newInstance(context);
    }

    private String getSelectedProfile(Context context) throws Exception {
        Object manager = newManager(context);
        Method method = manager.getClass().getDeclaredMethod("getSelectedProfile");
        method.setAccessible(true);
        Object value = method.invoke(manager);
        if (!(value instanceof Enum)) {
            throw new IllegalStateException("getSelectedProfile no devolvió CpuProfile");
        }
        return ((Enum<?>) value).name();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void selectProfile(Context context, String profileName) throws Exception {
        Object manager = newManager(context);
        Class<?> type = Class.forName(PROFILE, true, targetLoader);
        Object selected = Enum.valueOf((Class<? extends Enum>) type.asSubclass(Enum.class),
                profileName);
        Method method = manager.getClass().getDeclaredMethod("selectProfile", type);
        method.setAccessible(true);
        try {
            method.invoke(manager, selected);
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            if (cause instanceof Exception) throw (Exception) cause;
            throw e;
        }
    }

    private void sendStatus(ResultReceiver receiver, Context context) {
        Bundle data = new Bundle();

        data.putBoolean("injected", true);
        data.putBoolean("manager_class_found", managerClassFound);
        data.putBoolean("profile_class_found", profileClassFound);
        data.putBoolean("select_profile_hook_installed", selectProfileHookInstalled);
        data.putBoolean("attach_hook_installed", attachHookInstalled);
        data.putBoolean("bridge_ready", bridgeReceiver != null);

        ProfileEvent event = lastInterceptedEvent;
        if (event != null && event.elapsed > 0L) {
            data.putString("last_intercepted_profile", event.profile);
            data.putLong("last_intercepted_elapsed", event.elapsed);
        }

        try {
            String current = getSelectedProfile(context);
            data.putString(EXTRA_PROFILE, current);
            data.putBoolean("profile_available", true);
            data.putString("message", "Diagnóstico obtenido de Xiaomi Parts");
        } catch (Throwable t) {
            data.putBoolean("profile_available", false);
            data.putString("message", "Perfil no disponible: "
                    + t.getClass().getSimpleName());
            report("BRIDGE STATUS PROFILE ERROR: " + t);
        }

        receiver.send(0, data);
        report("BRIDGE STATUS: reply sent");
    }

    private static void send(ResultReceiver receiver, int code, String profile,
                             String message) {
        Bundle data = new Bundle();
        if (profile != null) data.putString(EXTRA_PROFILE, profile);
        data.putString("message", message);
        receiver.send(code, data);
    }
}
