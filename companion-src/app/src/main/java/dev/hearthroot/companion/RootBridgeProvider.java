package dev.hearthroot.companion;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.Process;
import android.os.ResultReceiver;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Synchronous root-only IPC endpoint for Hearthroot Control.
 * An authenticated root process calls it with `content call`; Companion
 * forwards requests to the signature-permission-protected LSPosed bridge.
 * No shell/regular app can select profiles. Never calls EXTREME or sysfs.
 */
public final class RootBridgeProvider extends ContentProvider {
    private static final String TARGET = "com.xiaomi.settings";
    private static final String ACTION = "dev.hearthroot.companion.action.CPU_CONTROL_V03";

    @Override public boolean onCreate() { return true; }

    private static Bundle response(String state, String profile, String message) {
        Bundle result = new Bundle();
        result.putString("status", state);
        if (profile != null) result.putString("profile", profile);
        result.putString("message", message);
        return result;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        // Binder identity is reliable here (unlike getSentFromUid() on broadcasts).
        int uid = Binder.getCallingUid();
        if (uid != 0) {
            return response("DENIED", null, "Root caller required, uid=" + uid);
        }
        if (!"QUERY".equals(method) && !"SET".equals(method)) {
            return response("INVALID", null, "Only QUERY/SET supported");
        }
        if ("SET".equals(method)
                && !"NORMAL".equals(arg)
                && !"ECONOMY".equals(arg)
                && !"BOOST".equals(arg)) {
            return response("INVALID", null, "Unsupported profile (EXTREME forbidden)");
        }
        Context context = getContext();
        if (context == null) return response("ERROR", null, "Context unavailable");
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<Bundle> answer = new AtomicReference<>();
        AtomicReference<Integer> code = new AtomicReference<>(1);
        ResultReceiver callback = new ResultReceiver(null) {
            @Override protected void onReceiveResult(int resultCode, Bundle data) {
                if (done.getCount() == 0) return;
                code.set(resultCode);
                answer.set(data);
                done.countDown();
            }
        };
        Intent intent = new Intent(ACTION).setPackage(TARGET);
        intent.putExtra("command", method);
        if ("SET".equals(method)) intent.putExtra("profile", arg);
        intent.putExtra("reply", callback);
        try {
            context.sendBroadcast(intent);
            if (!done.await(5, TimeUnit.SECONDS)) {
                return response("OFFLINE", null, "Xiaomi Parts bridge did not respond");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return response("ERROR", null, "Interrupted");
        } catch (RuntimeException e) {
            return response("ERROR", null, "Broadcast: " + e.getClass().getSimpleName());
        }
        Bundle data = answer.get();
        String reported = data == null ? null : data.getString("profile");
        String message = data == null ? "Empty response" : data.getString("message", "");
        if (code.get() != 0 || reported == null) {
            return response("ERROR", reported, message);
        }
        if ("SET".equals(method) && !arg.equals(reported)) {
            return response("MISMATCH", reported, "Xiaomi Parts reported a different profile");
        }
        return response("OK", reported, message);
    }

    @Override public String getType(Uri uri) { return null; }
    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                   String[] selectionArgs, String sortOrder) {
        throw new UnsupportedOperationException();
    }
    @Override public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }
    @Override public int update(Uri uri, ContentValues values, String selection,
                                String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }
}
