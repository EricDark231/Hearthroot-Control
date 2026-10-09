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

    private ClassLoader targetLoader;
    private BroadcastReceiver bridgeReceiver;

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
        try {
            report("FOUND " + Class.forName(name, false, targetLoader).getName());
        } catch (Throwable t) {
            report("MISSING " + name + " " + t.getClass().getSimpleName());
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
                    report("PROFILE SELECTED: " + String.valueOf(selected));
                    return result;
                });
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
                    if ("QUERY".equals(command)) {
                        send(reply, 0, getSelectedProfile(context), "Perfil declarado por Xiaomi Parts");
                    } else if ("SET".equals(command)) {
                        String requested = intent.getStringExtra(EXTRA_PROFILE);
                        // Allow only validated non-EXTREME modes. Never modify thermal controls.
                        if (!"NORMAL".equals(requested)
                                && !"ECONOMY".equals(requested)
                                && !"BOOST".equals(requested)) {
                            send(reply, 1, null, "Modo no permitido en v0.3.5");
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

    private static void send(ResultReceiver receiver, int code, String profile,
                             String message) {
        Bundle data = new Bundle();
        if (profile != null) data.putString(EXTRA_PROFILE, profile);
        data.putString("message", message);
        receiver.send(code, data);
    }
}
