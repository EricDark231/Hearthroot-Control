package dev.hearthroot.companion;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.util.Log;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Boot-time handshake only. No activity launch, no persistent service,
 * no CPU sysfs writes, and no profile application.
 */
public final class BootBridgeReceiver extends BroadcastReceiver {
    public static final String PREF_NAME = "hearthroot_bridge_boot";
    public static final String STATUS_KEY = "bridge_status";

    private static final String TAG = "HearthrootBoot";
    private static final String ACTION = "dev.hearthroot.companion.action.CPU_CONTROL_V03";
    private static final String TARGET = "com.xiaomi.settings";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_BOOT_COMPLETED.equals(action)) return;

        final PendingResult pending = goAsync();
        final Context safeContext = context.createDeviceProtectedStorageContext();
        new Thread(() -> {
            try {
                save(safeContext, "Comprobando comunicación");
                boolean ready = false;
                for (int attempt = 0; attempt < 6 && !ready; attempt++) {
                    ready = queryBridge(safeContext);
                    if (!ready && attempt < 5) Thread.sleep(200);
                }
                if (ready) {
                    save(safeContext, "Puente respondió correctamente");
                    Log.i(TAG, "BOOT BRIDGE READY (QUERY only)");
                } else {
                    save(safeContext, "Puente sin respuesta al arrancar");
                    Log.w(TAG, "BOOT BRIDGE NOT READY; on-demand recovery available");
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                save(safeContext, "Comprobación interrumpida");
            } catch (RuntimeException e) {
                Log.w(TAG, "BOOT BRIDGE CHECK ERROR: " + e.getClass().getSimpleName());
                save(safeContext, "Error al comprobar el puente");
            } finally {
                pending.finish();
            }
        }, "Hearthroot-Boot-Bridge").start();
    }

    private static boolean queryBridge(Context context) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> profile = new AtomicReference<>();
        ResultReceiver reply = new ResultReceiver(new Handler(Looper.getMainLooper())) {
            @Override
            protected void onReceiveResult(int code, Bundle data) {
                if (code == 0 && data != null) profile.set(data.getString("profile"));
                done.countDown();
            }
        };
        Intent query = new Intent(ACTION).setPackage(TARGET);
        query.putExtra("command", "QUERY");
        query.putExtra("reply", reply);
        try {
            context.sendBroadcast(query);
        } catch (SecurityException | IllegalArgumentException e) {
            Log.w(TAG, "Cannot query bridge: " + e.getClass().getSimpleName());
            return false;
        }
        done.await(900, TimeUnit.MILLISECONDS);
        return profile.get() != null;
    }

    private static void save(Context context, String text) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(STATUS_KEY, text).apply();
    }
}
