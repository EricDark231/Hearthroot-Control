package dev.hearthroot.companion;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.BroadcastOptions;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ResultReceiver;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.os.SystemClock;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Companion's own diagnostic UI. This is NOT a Hearthroot Control WebUI panel.
 * QUERY reads the selected profile from Xiaomi Parts. SET is explicit and
 * limited to NORMAL/ECONOMY for the experimental test.
 */
public final class MainActivity extends Activity {
    private static final String TARGET = "com.xiaomi.settings";
    private static final String ACTION = "dev.hearthroot.companion.action.CPU_CONTROL_V03";
    private static final String PREFS = "companion_status";
    private static final int BG = Color.rgb(17, 27, 25);
    private static final int CARD = Color.rgb(28, 45, 40);
    private static final int WHITE = Color.rgb(233, 239, 231);
    private static final int MUTED = Color.rgb(161, 181, 170);
    private static final int GREEN = Color.rgb(153, 222, 175);
    private static final int AMBER = Color.rgb(241, 195, 126);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView headline, injection, classes, hook, selectedProfile, lastEvent, cpuOnline, details, bootStatus;
    private Button refresh, economy, boost, normal;
    private int requestSerial;
    private int pendingRequest;
    private boolean waitingForXiaomiParts;
    private final java.util.ArrayList<Runnable> bridgeTimers =
            new java.util.ArrayList<>();

    private void scheduleBridgeTimer(Runnable task, long delayMs) {
        bridgeTimers.add(task);
        handler.postDelayed(task, delayMs);
    }

    private void clearBridgeTimers() {
        for (Runnable task : bridgeTimers) {
            handler.removeCallbacks(task);
        }
        bridgeTimers.clear();
    }


    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);
        LinearLayout body = new LinearLayout(this);
        body.setPadding(dp(22), dp(32), dp(22), dp(34));
        body.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(body);
        setContentView(scroll);

        label(body, "H E A R T H R O O T  ·  P R O J E C T", 11, MUTED, false);
        LinearLayout heading = new LinearLayout(this);
        heading.setOrientation(LinearLayout.HORIZONTAL);
        heading.setGravity(android.view.Gravity.CENTER_VERTICAL);
        body.addView(heading, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        heading.addView(titles, new LinearLayout.LayoutParams(0, -2, 1));
        label(titles, "Companion", 30, WHITE, true);
        label(titles, "LSPosed  ·  Xiaomi Parts  ·  API 101", 13, MUTED, false);
        Button settingsGear = new Button(this);
        settingsGear.setText("⚙");
        settingsGear.setAllCaps(false);
        settingsGear.setTextSize(23);
        settingsGear.setTextColor(GREEN);
        settingsGear.setContentDescription("Abrir controles de desarrollo");
        GradientDrawable gearGlass = new GradientDrawable();
        gearGlass.setColor(CARD);
        gearGlass.setCornerRadius(dp(14));
        gearGlass.setStroke(dp(1), Color.rgb(72, 110, 88));
        settingsGear.setBackground(gearGlass);
        heading.addView(settingsGear, new LinearLayout.LayoutParams(dp(49), dp(49)));
        spacer(body, 22);

        LinearLayout summary = card(body);
        label(summary, "DIAGNÓSTICO", 11, MUTED, false);
        headline = label(summary, "Comprobando...", 21, AMBER, true);
        bootStatus = label(summary, "Inicio de Android: sin comprobar", 12, MUTED, false);
        spacer(body, 12);

        LinearLayout signals = card(body);
        injection = signal(signals, "Inyección LSPosed");
        divider(signals);
        classes = signal(signals, "Clases Xiaomi Parts");
        divider(signals);
        hook = signal(signals, "Hook selectProfile()");
        spacer(body, 12);

        LinearLayout live = card(body);
        label(live, "PERFIL DECLARADO POR XIAOMI PARTS", 11, MUTED, false);
        selectedProfile = label(live, "Consultando...", 20, WHITE, true);
        cpuOnline = label(live, "CPU en línea: comprobando", 12, MUTED, false);
        divider(live);
        label(live, "ÚLTIMO CAMBIO INTERCEPTADO", 11, MUTED, false);
        lastEvent = label(live, "Sin eventos en esta sesión", 15, WHITE, true);
        spacer(body, 15);

        refresh = action(body, "Actualizar diagnóstico", GREEN, BG,
                () -> refreshAll(true));
        spacer(body, 15);
        LinearLayout manualPanel = new LinearLayout(this);
        manualPanel.setOrientation(LinearLayout.VERTICAL);
        manualPanel.setVisibility(View.GONE);
        body.addView(manualPanel, new LinearLayout.LayoutParams(-1, -2));
        settingsGear.setOnClickListener(v -> {
            boolean open = manualPanel.getVisibility() != View.VISIBLE;
            manualPanel.setVisibility(open ? View.VISIBLE : View.GONE);
            settingsGear.setContentDescription(open ? "Cerrar controles de desarrollo" : "Abrir controles de desarrollo");
        });
        label(manualPanel, "PRUEBA DE SINCRONIZACIÓN", 11, MUTED, false);
        label(manualPanel, "Normal, Ahorro e Impulso. Companion consulta el puente " +
                "sin abrir Xiaomi Parts; si el proceso está detenido, avisará.",
                13, MUTED, false);
        spacer(manualPanel, 8);
        economy = action(manualPanel, "Solicitar Ahorro (ECONOMY)", CARD, WHITE,
                () -> confirmChange("ECONOMY", "Ahorro de batería"));
        spacer(manualPanel, 8);
        boost = action(manualPanel, "Solicitar Impulso (BOOST)", CARD, WHITE,
                () -> confirmChange("BOOST", "Impulso"));
        spacer(manualPanel, 8);
        normal = action(manualPanel, "Restaurar Normal (NORMAL)", CARD, WHITE,
                () -> confirmChange("NORMAL", "Normal"));
        spacer(manualPanel, 12);
        details = label(body, "Sin comandos enviados.", 12, MUTED, false);

        String known = getPreferences(MODE_PRIVATE).getString("last_profile", "");
        if (!known.isEmpty()) {
            selectedProfile.setText(pretty(known) + " · último conocido (sin confirmar)");
            selectedProfile.setTextColor(AMBER);
        }
        refreshBootStatus();
        refreshAll();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (bootStatus != null) refreshBootStatus();
    }

    private void refreshBootStatus() {
        android.content.SharedPreferences prefs = createDeviceProtectedStorageContext()
                .getSharedPreferences(BootBridgeReceiver.PREF_NAME, MODE_PRIVATE);
        String state = prefs.getString(BootBridgeReceiver.STATUS_KEY,
                "Verificación pendiente");
        bootStatus.setText("Inicio de Android: " + state + " · último sondeo");
    }

    private void refreshAll() {
        // STATUS primero, descongelación puntual después.
        // No se abre la interfaz de Xiaomi Parts.
        refreshAll(true);
    }

    private void refreshAll(boolean mayWakeXiaomiParts) {
        sendRequest("STATUS", null, mayWakeXiaomiParts);
        refreshCpuOnline();
    }

    private void confirmChange(String profile, String name) {
        String consequences = "¿Solicitar «" + name + "»? Xiaomi Parts controlará " +
                "las frecuencias de CPU. En Ahorro podrían desconectarse CPU 4–7; " +
                "en Impulso puede aumentar el consumo y la temperatura. " +
                "Companion no modifica controles térmicos ni governors.";
        new AlertDialog.Builder(this)
                .setTitle("Cambiar perfil en Xiaomi Parts")
                .setMessage(consequences)
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Aplicar", (d, which) -> sendRequest("SET", profile, true))
                .show();
    }

    // Sondeo pasivo. Nunca iniciar una Activity de Xiaomi Parts.
    // La consulta inicial al abrir Companion permanece pasiva.
    private void sendRequest(String command, String requested, boolean mayWake) {
        // Una sola operación activa: evita reemplazar solicitudes pendientes.
        if (pendingRequest != 0) {
            android.util.Log.i("HearthrootBridge",
                    "REQUEST SKIPPED: command=" + command
                    + " pending=" + pendingRequest);
            return;
        }

        final int serial = ++requestSerial;
        android.util.Log.i("HearthrootBridge",
                "REQUEST START: command=" + command
                + " serial=" + serial
                + " previous=" + pendingRequest
                + " elapsed=" + SystemClock.elapsedRealtime());
        pendingRequest = serial;
        waitingForXiaomiParts = false;
        setButtonsEnabled(false);
        details.setText("Comprobando puente Xiaomi Parts (" + command + ")...");
        if ("STATUS".equals(command)) {
            showBridgeUnverified();
        }
        if ("QUERY".equals(command)) {
            selectedProfile.setText("Consultando Xiaomi Parts...");
            selectedProfile.setTextColor(AMBER);
        }
        if (mayWake) {
            if ("STATUS".equals(command)) {
                // Encolar STATUS antes de descongelar el receptor.
                dispatchRequest(serial, command, requested);
            } else {
                // Encolar QUERY antes de descongelar; SET espera su respuesta.
                probeBridge(serial, 0, command, requested);
            }
            wakeXiaomiParts(serial, command, requested);
        } else {
            dispatchRequest(serial, command, requested);
        }
    }

    // Descongelación puntual mediante BakaSU. Android conserva su freezer.
    private void wakeXiaomiParts(int serial, String command, String requested) {
        new Thread(() -> {
            Process process = null;
            boolean success = false;
            String result = "";

            try {
                process = new ProcessBuilder("su", "-c",
                        "am unfreeze com.xiaomi.settings")
                        .redirectErrorStream(true)
                        .start();

                if (!process.waitFor(5, TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                    result = "timeout";
                } else {
                    success = process.exitValue() == 0;
                    result = "exit=" + process.exitValue();
                }
            } catch (Exception e) {
                result = e.getClass().getSimpleName();
            } finally {
                if (process != null) process.destroy();
            }

            final boolean woke = success;
            final String outcome = result;

            handler.post(() -> {
                android.util.Log.i("HearthrootBridge",
                        "WAKE RESULT: serial=" + serial
                        + " success=" + woke
                        + " result=" + outcome);

                if (!isRequestActive(serial)) return;

                if ("STATUS".equals(command)) {
                    // STATUS ya fue enviado; no duplicar el broadcast.
                    if (!woke) {
                        android.util.Log.w("HearthrootBridge",
                                "STATUS wake failed: " + outcome);
                    }
                } else if (!woke) {
                    failRequest(serial,
                            "No se pudo preparar Xiaomi Parts mediante BakaSU: "
                            + outcome);
                }
                // QUERY ya fue enviado antes de la descongelación.
                // Su callback es el único autorizado para iniciar SET.
            });
        }, "Hearthroot-Bridge-Wake").start();
    }

    // Descongelación posterior al envío de SET.
    // No repetir QUERY ni SET: solo liberar su entrega pendiente.
    private void wakePendingSet(int serial) {
        new Thread(() -> {
            Process process = null;
            String result;
            try {
                process = new ProcessBuilder("su", "-c",
                        "am unfreeze com.xiaomi.settings")
                        .redirectErrorStream(true)
                        .start();

                if (!process.waitFor(5, TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                    result = "timeout";
                } else {
                    result = "exit=" + process.exitValue();
                }
            } catch (Exception e) {
                result = e.getClass().getSimpleName();
            } finally {
                if (process != null) process.destroy();
            }

            android.util.Log.i("HearthrootBridge",
                    "SET WAKE RESULT: serial=" + serial
                    + " result=" + result);
        }, "Hearthroot-Set-Wake").start();
    }

    private boolean isRequestActive(int serial) {
        // Una respuesta tardía de una operación finalizada se ignora.
        // No representa un error del puente.
        return pendingRequest == serial
                && !isFinishing()
                && !isDestroyed();
    }

    // PING es exclusivamente QUERY; no duplicar SET durante los reintentos.
    private void probeBridge(int serial, int attempt, String command, String requested) {
        if (!isRequestActive(serial)) return;
        final AtomicBoolean completed = new AtomicBoolean(false);
        ResultReceiver pingReply = new ResultReceiver(handler) {
            @Override
            protected void onReceiveResult(int code, Bundle data) {
                android.util.Log.i("HearthrootBridge",
                        "PROBE CALLBACK: attempt=" + attempt
                        + " serial=" + serial
                        + " active=" + isRequestActive(serial)
                        + " completed=" + completed.get()
                        + " code=" + code
                        + " profile=" + (data == null ? null : data.getString("profile")));

                if (!isRequestActive(serial)
                        || !completed.compareAndSet(false, true)) return;

                if (code == 0 && data != null && data.getString("profile") != null) {
                    waitingForXiaomiParts = false;
                    // QUERY confirmado. Enviar SET antes de descongelar.
                    dispatchRequest(serial, command, requested);
                    if ("SET".equals(command) && isRequestActive(serial)) {
                        wakePendingSet(serial);
                    }
                } else {
                    String reason = data == null ? "Respuesta vacía" :
                            data.getString("message", "Error sin detalle");
                    failRequest(serial, "El puente respondió con error: " + reason);
                }
            }
        };
        Intent ping = new Intent(ACTION).setPackage(TARGET);
        ping.putExtra("command", "QUERY");
        ping.putExtra("reply", pingReply);
        try {
            sendBridgeBroadcast(ping);
        } catch (RuntimeException e) {
            if (completed.compareAndSet(false, true)) {
                failRequest(serial, "No se pudo consultar el puente: " +
                        e.getClass().getSimpleName());
            }
            return;
        }
        scheduleBridgeTimer(() -> {
            if (isRequestActive(serial) && completed.compareAndSet(false, true)) {
                onProbeTimeout(serial, attempt, command, requested);
            }
        }, 1200);
    }

    // Reintentos silenciosos. Nunca mostrar Xiaomi Parts en primer plano.
    // Si Android finalizó su proceso, fallamos con un mensaje claro en lugar
    // de abrir una Activity visible; la recuperación invisible queda pendiente.
    private void onProbeTimeout(int serial, int attempt,
                                String command, String requested) {
        if (!isRequestActive(serial)) return;
        if (attempt < 3) {
            details.setText("Esperando puente LSPosed (" + (attempt + 1) + "/3)...");
            scheduleBridgeTimer(
                    () -> probeBridge(serial, attempt + 1, command, requested),
                    350);
        } else {
            failRequest(serial, "Xiaomi Parts no respondió en segundo plano. " +
                    "No se abrió su interfaz. Verifica que el proceso esté activo " +
                    "y que LSPosed mantenga el alcance correcto.");
        }
    }

    private void failRequest(int serial, String reason) {
        if (!isRequestActive(serial)) return;
        android.util.Log.i("HearthrootBridge",
                "REQUEST FAILED: serial=" + serial
                + " reason=" + reason
                + " elapsed=" + SystemClock.elapsedRealtime());
        clearBridgeTimers();
        pendingRequest = 0;
        setButtonsEnabled(true);
        if (hasConfirmedBridgeStatus) showBridgeStale();
        showFallback(reason);
    }

    private void sendBridgeBroadcast(Intent intent) {
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            BroadcastOptions options = BroadcastOptions.makeBasic();
            options.setDeferralPolicy(
                    BroadcastOptions.DEFERRAL_POLICY_NONE);
            sendBroadcast(intent, null, options.toBundle());
        } else {
            sendBroadcast(intent);
        }
    }

    private void dispatchRequest(int serial, String command, String requested) {
        if (!isRequestActive(serial)) return;
        ResultReceiver reply = new ResultReceiver(handler) {
            @Override
            protected void onReceiveResult(int code, Bundle data) {
                android.util.Log.i("HearthrootBridge",
                        "REQUEST CALLBACK: command=" + command
                        + " serial=" + serial
                        + " active=" + isRequestActive(serial)
                        + " code=" + code
                        + " profile=" + (data == null ? null : data.getString("profile")));

                if (!isRequestActive(serial)) return;

                // Cancelar los temporizadores al recibir la respuesta.
                clearBridgeTimers();
                pendingRequest = 0;
                setButtonsEnabled(true);
                String message = data == null ? "Sin detalle" :
                        data.getString("message", "Sin detalle");
                String profile = data == null ? null : data.getString("profile");
                if ("STATUS".equals(command) && code == 0 && data != null) {
                    showBridgeStatus(data);

                    if (!data.getBoolean("profile_available", false)
                            || profile == null) {
                        showFallback("Diagnóstico recibido, pero Xiaomi Parts "
                                + "no pudo confirmar el perfil: " + message);
                        return;
                    }
                }

                if (code == 0 && profile != null) {
                    // El perfil es lectura devuelta por Xiaomi Parts, no una suposición.
                    getPreferences(MODE_PRIVATE).edit()
                            .putString("last_profile", profile).apply();
                    selectedProfile.setText(pretty(profile));
                    selectedProfile.setTextColor(GREEN);
                    details.setText(message + ". Perfil declarado: " + profile + "." +
                            (waitingForXiaomiParts ?
                             " Regresa a Companion para revisar el resultado." : ""));
                    refreshCpuOnline();
                } else {
                    showFallback("Xiaomi Parts respondió con error: " + message);
                }
            }
        };
        Intent request = new Intent(ACTION).setPackage(TARGET);
        request.putExtra("command", command);

        if ("SET".equals(command)) {
            request.putExtra("profile", requested);
            request.putExtra("sent_at_elapsed", SystemClock.elapsedRealtime());
        }

        request.putExtra("reply", reply);
        try {
            sendBridgeBroadcast(request);
        } catch (RuntimeException e) {
            failRequest(serial, "No se pudo enviar el comando: " +
                    e.getClass().getSimpleName());
            return;
        }
        scheduleBridgeTimer(() -> {
            if (isRequestActive(serial)) {
                String reason = "STATUS".equals(command)
                        ? "Xiaomi Parts no respondió al diagnóstico STATUS. "
                                + "El estado de LSPosed permanece sin verificar."
                        : "El puente no confirmó el comando " + command
                                + " dentro del tiempo de espera.";
                failRequest(serial, reason);
            }
        }, 9000);
    }

    private void showFallback(String why) {
        String known = getPreferences(MODE_PRIVATE).getString("last_profile", "");
        selectedProfile.setText(known.isEmpty() ? "No disponible" :
                pretty(known) + " · último conocido (sin confirmar)");
        selectedProfile.setTextColor(AMBER);
        details.setText(why);
    }

    private void setButtonsEnabled(boolean enabled) {
        refresh.setEnabled(enabled);
        economy.setEnabled(enabled);
        boost.setEnabled(enabled);
        normal.setEnabled(enabled);
    }

    private void refreshCpuOnline() {
        new Thread(() -> {
            String value = "No disponible";
            String error = "";
            // Primero intentar lectura ordinaria, sin root.
            try (BufferedReader reader = new BufferedReader(new FileReader(
                    "/sys/devices/system/cpu/online"))) {
                String line = reader.readLine();
                if (line != null && line.matches("[0-9,-]+")) value = line;
            } catch (Exception e) {
                error = e.getClass().getSimpleName();
            }
            // Si falla por restricciones de SELinux, usar la autorización BakaSU
            // ya otorgada a Companion. Es una lectura, nunca una escritura.
            if ("No disponible".equals(value)) {
                Process process = null;
                try {
                    process = new ProcessBuilder("su", "-c",
                            "cat /sys/devices/system/cpu/online")
                            .redirectErrorStream(true).start();
                    if (!process.waitFor(5, TimeUnit.SECONDS)) {
                        process.destroyForcibly();
                        throw new IllegalStateException("Root sin respuesta");
                    }
                    if (process.exitValue() == 0) {
                        try (BufferedReader reader = new BufferedReader(
                                new InputStreamReader(process.getInputStream(),
                                        StandardCharsets.UTF_8))) {
                            String line = reader.readLine();
                            if (line != null && line.trim().matches("[0-9,-]+"))
                                value = line.trim();
                        }
                    } else {
                        error = "su exit " + process.exitValue();
                    }
                } catch (Exception e) {
                    error = e.getClass().getSimpleName();
                } finally {
                    if (process != null) process.destroy();
                }
            }
            final String text = value;
            final String reason = error;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                cpuOnline.setText("CPU en línea: " + text);
                if ("No disponible".equals(text) && !reason.isEmpty()) {
                    details.setText("No se pudo leer CPU en línea (" + reason + "). " +
                            "Comprueba root de Companion en BakaSU.");
                }
            });
        }, "Hearthroot-Cpu-Read").start();
    }

    private boolean hasConfirmedBridgeStatus = false;

    private void showBridgeUnverified() {
        if (hasConfirmedBridgeStatus) {
            headline.setText("Actualizando diagnóstico · último estado conocido");
            headline.setTextColor(AMBER);
            return;
        }

        injection.setText("○ Inyección sin verificar");
        classes.setText("○ Clases sin verificar");
        hook.setText("○ Hook sin verificar");
        lastEvent.setText("Sin verificar · esperando Xiaomi Parts");

        injection.setTextColor(AMBER);
        classes.setTextColor(AMBER);
        hook.setTextColor(AMBER);

        headline.setText("Esperando diagnóstico del módulo");
        headline.setTextColor(AMBER);
    }

    private void showBridgeStale() {
        if (!hasConfirmedBridgeStatus) return;

        injection.setTextColor(AMBER);
        classes.setTextColor(AMBER);
        hook.setTextColor(AMBER);

        headline.setText("Último diagnóstico conocido · sin confirmar");
        headline.setTextColor(AMBER);
        lastEvent.setText("Último evento conocido · sin actualizar");
    }

    private void showBridgeStatus(Bundle data) {
        hasConfirmedBridgeStatus = true;
        boolean injected = data.getBoolean("injected", false);
        boolean managerFound = data.getBoolean("manager_class_found", false);
        boolean profileFound = data.getBoolean("profile_class_found", false);
        boolean hookInstalled = data.getBoolean(
                "select_profile_hook_installed", false);
        boolean attachInstalled = data.getBoolean(
                "attach_hook_installed", false);
        boolean bridgeReady = data.getBoolean("bridge_ready", false);

        boolean classesFound = managerFound && profileFound;

        String interceptedProfile = data.getString("last_intercepted_profile");
        long interceptedAt = data.getLong("last_intercepted_elapsed", -1L);
        long now = SystemClock.elapsedRealtime();

        if (interceptedProfile != null && interceptedAt > 0L
                && interceptedAt <= now) {
            long seconds = (now - interceptedAt) / 1000L;
            String elapsed = seconds < 60L
                    ? "hace " + seconds + " s"
                    : "hace " + (seconds / 60L) + " min";
            lastEvent.setText(pretty(interceptedProfile) + " · " + elapsed);
        } else {
            lastEvent.setText("Sin eventos en esta sesión");
        }

        injection.setText(injected
                ? "● Inyección confirmada"
                : "○ Inyección no confirmada");
        classes.setText(classesFound
                ? "● Ambas clases encontradas"
                : "○ Faltan clases de Xiaomi Parts");
        hook.setText(hookInstalled
                ? "● selectProfile() instalado"
                : "○ Hook selectProfile() no instalado");

        injection.setTextColor(injected ? GREEN : AMBER);
        classes.setTextColor(classesFound ? GREEN : AMBER);
        hook.setTextColor(hookInstalled ? GREEN : AMBER);

        if (injected && classesFound && hookInstalled
                && attachInstalled && bridgeReady) {
            headline.setText("LSPosed y canal listos");
            headline.setTextColor(GREEN);
        } else {
            headline.setText("Diagnóstico parcial del módulo");
            headline.setTextColor(AMBER);
        }
    }

    private static String pretty(String name) {
        if ("NORMAL".equalsIgnoreCase(name)) return "Normal";
        if ("ECONOMY".equalsIgnoreCase(name)) return "Ahorro de batería";
        if ("BOOST".equalsIgnoreCase(name)) return "Impulso";
        if ("EXTREME".equalsIgnoreCase(name)) return "Extremo";
        if ("CUSTOM".equalsIgnoreCase(name)) return "Personalizado";
        return name;
    }

    private int dp(int n) {
        return Math.round(getResources().getDisplayMetrics().density * n);
    }

    private LinearLayout card(LinearLayout body) {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(17), dp(17), dp(17), dp(17));
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(CARD);
        shape.setCornerRadius(dp(16));
        panel.setBackground(shape);
        body.addView(panel, new LinearLayout.LayoutParams(-1, -2));
        return panel;
    }

    private TextView label(LinearLayout parent, String text, int size, int color, boolean bold) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setTextSize(size);
        label.setTextColor(color);
        if (bold) label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(7);
        parent.addView(label, params);
        return label;
    }

    private TextView signal(LinearLayout parent, String title) {
        label(parent, title, 14, WHITE, true);
        return label(parent, "Sin comprobar", 13, AMBER, false);
    }

    private Button action(LinearLayout parent, String title, int background, int foreground,
                          Runnable callback) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(title);
        button.setTextSize(14);
        button.setTextColor(foreground);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(background);
        shape.setCornerRadius(dp(14));
        button.setBackground(shape);
        button.setOnClickListener(v -> callback.run());
        parent.addView(button, new LinearLayout.LayoutParams(-1, dp(52)));
        return button;
    }

    private void divider(LinearLayout parent) {
        View line = new View(this);
        line.setBackgroundColor(Color.rgb(57, 77, 68));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(1));
        p.topMargin = dp(10);
        p.bottomMargin = dp(13);
        parent.addView(line, p);
    }

    private void spacer(LinearLayout body, int n) {
        body.addView(new View(this), new LinearLayout.LayoutParams(1, dp(n)));
    }
}
