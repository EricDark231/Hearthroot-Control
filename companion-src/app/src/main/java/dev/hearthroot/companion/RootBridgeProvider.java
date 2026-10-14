package dev.hearthroot.companion;

import android.app.BroadcastOptions;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.ResultReceiver;
import android.os.SystemClock;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class RootBridgeProvider extends ContentProvider {
    private static final String TARGET = "com.xiaomi.settings";
    private static final String ACTION =
            "dev.hearthroot.companion.action.CPU_CONTROL_V03";

    private static final Object OPERATION_LOCK = new Object();

    @Override
    public boolean onCreate() {
        return true;
    }

    private static Bundle response(String status, String profile, String message) {
        Bundle result = new Bundle();
        result.putString("status", status);
        if (profile != null) result.putString("profile", profile);
        result.putString("message", message);
        return result;
    }

    private static void send(Context context, Intent intent) {
        if (Build.VERSION.SDK_INT >= 34) {
            BroadcastOptions options = BroadcastOptions.makeBasic();
            options.setDeferralPolicy(BroadcastOptions.DEFERRAL_POLICY_NONE);
            context.sendBroadcast(intent, null, options.toBundle());
        } else {
            context.sendBroadcast(intent);
        }
    }

    private static void wake() {
        new Thread(() -> {
            Process process = null;
            try {
                process = new ProcessBuilder(
                        "su", "-c", "am unfreeze com.xiaomi.settings")
                        .redirectErrorStream(true)
                        .start();

                if (!process.waitFor(5, TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                }
            } catch (Exception ignored) {
                // El resultado real se comprueba mediante el callback.
            } finally {
                if (process != null) process.destroy();
            }
        }, "Hearthroot-Provider-Wake").start();
    }

    private static Bundle request(Context context, String command,
                                  String profile, long timeoutMs) {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Bundle> answer = new AtomicReference<>();
        AtomicReference<Integer> code = new AtomicReference<>(1);

        ResultReceiver receiver = new ResultReceiver(null) {
            @Override
            protected void onReceiveResult(int resultCode, Bundle data) {
                if (done.getCount() == 0) return;
                code.set(resultCode);
                answer.set(data);
                done.countDown();
            }
        };

        Intent intent = new Intent(ACTION).setPackage(TARGET);
        intent.putExtra("command", command);
        intent.putExtra("reply", receiver);

        if ("SET".equals(command)) {
            intent.putExtra("profile", profile);
            intent.putExtra("sent_at_elapsed", SystemClock.elapsedRealtime());
        }

        try {
            send(context, intent);
            wake();

            if (!done.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                return response("TIMEOUT", null,
                        command + " did not receive confirmation");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return response("ERROR", null, "Interrupted");
        } catch (RuntimeException e) {
            return response("ERROR", null,
                    "Broadcast: " + e.getClass().getSimpleName());
        }

        Bundle data = answer.get();
        String reported = data == null ? null : data.getString("profile");
        String message = data == null ? "Empty response" :
                data.getString("message", "");

        if (code.get() != 0 || reported == null) {
            return response("ERROR", reported, message);
        }

        if ("SET".equals(command) && !profile.equals(reported)) {
            return response("MISMATCH", reported,
                    "Xiaomi Parts reported a different profile");
        }

        return response("OK", reported, message);
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        if (Binder.getCallingUid() != 0) {
            return response("DENIED", null, "Root caller required");
        }

        if (!"QUERY".equals(method) && !"SET".equals(method)) {
            return response("INVALID", null, "Only QUERY/SET supported");
        }

        if ("SET".equals(method)
                && !"NORMAL".equals(arg)
                && !"ECONOMY".equals(arg)
                && !"BOOST".equals(arg)) {
            return response("INVALID", null,
                    "Unsupported profile (EXTREME forbidden)");
        }

        Context context = getContext();
        if (context == null) {
            return response("ERROR", null, "Context unavailable");
        }

        synchronized (OPERATION_LOCK) {
            if ("QUERY".equals(method)) {
                return request(context, "QUERY", null, 9000);
            }

            Bundle probe = request(context, "QUERY", null, 9000);
            if (!"OK".equals(probe.getString("status"))) {
                return probe;
            }

            return request(context, "SET", arg, 9000);
        }
    }

    @Override public String getType(Uri uri) { return null; }

    @Override public Cursor query(Uri uri, String[] projection,
            String selection, String[] selectionArgs, String sortOrder) {
        throw new UnsupportedOperationException();
    }

    @Override public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override public int delete(Uri uri, String selection,
            String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }

    @Override public int update(Uri uri, ContentValues values,
            String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }
}
