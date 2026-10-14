"use strict";

(() => {
  const MODULE_SCRIPT =
    "/data/adb/modules/hearthroot.control/scripts/profiles.sh";

  // Enable only after read-only testing on the device.
  const ENABLE_WRITES = true;

  const choices = [...document.querySelectorAll(".choice")];
  const notice = document.getElementById("apply-progress-message");
  const progressPanel = document.getElementById("apply-progress");
  const progressFill = document.getElementById("apply-progress-fill");

  function progressStage(message, state = "working") {
    progressPanel.hidden = false;
    progressPanel.dataset.state = state;

    notice.classList.remove("apply-message-enter");
    void notice.offsetWidth;
    notice.textContent = message;
    notice.classList.add("apply-message-enter");
  }

  function progressMessage(message, state = "info") {
    // Do not interrupt an ongoing profile application.
    if (busy && progressPanel.dataset.state === "working") return;

    // Informational messages should not open the Apply panel.
    if (state === "info") return;

    progressStage(message, state);
  }

  function progressStart(profile) {
    progressFill.style.width = "";
    progressStage(`Preparing ${profile} profile...`);
  }

  function progressWorking() {
    progressStage("Applying kernel and Xiaomi Parts settings...");
  }

  function progressFinish(message, success) {
    progressStage(message, success ? "success" : "error");
    if (success) {
      progressFill.style.width = "100%";
    }
  }
  const currentState = document.getElementById("profile-current-state");
  const currentDetail = document.getElementById("profile-current-detail");
  const refreshButton = document.getElementById("profile-refresh");
  const applyButton = document.getElementById("profile-apply");

  let selected =
    choices.find(button => button.classList.contains("selected"))
      ?.dataset.profile || "Native";

  const experimentalPanel =
    document.getElementById("experimental-controls");
  const experimentalCpu =
    document.getElementById("experimental-cpu");
  const experimentalIo =
    document.getElementById("experimental-io");
  const experimentalXiaomi = document.getElementById("experimental-xiaomi");

  const recoveryCpu = document.getElementById("recovery-cpu");
  const recoveryIo = document.getElementById("recovery-io");
  const recoveryApply = document.getElementById("recovery-apply");
  const recoveryStatus = document.getElementById("recovery-status");

  const companionStatus = document.getElementById("companion-status");
  const companionDetail = document.getElementById("companion-detail");

  let recoveryBusy = false;
  let customReady = false;
  let customBusy = false;
  let customCpuOptions = [];
  let customIoOptions = [];
  let lastStatus = null;

  let compatible = false;
  let busy = false;

  const supportedProfiles = ["Balanced", "Native", "Battery Saver", "Performance", "Experimental"];

  const profileDescriptions = {
    Balanced: {
      description:
        "Designed for smooth everyday performance and efficient resource management.",
      cpu: "schedutil",
      io: "kyber",
      note:
        "CPU/GPU frequency limits remain unchanged. Thermal behavior is managed by Xiaomi Parts."
    },
    Native: {
      description:
        "Restores Hearthroot Kernel's native CPU governor and I/O scheduler.",
      cpu: "sugov_ext",
      io: "none",
      note:
        "CPU/GPU frequency limits remain unchanged. Thermal behavior is managed by Xiaomi Parts."
    },
    "Battery Saver": {
      description:
        "A lighter CPU scaling policy with native I/O scheduling.",
      cpu: "conservative",
      io: "none",
      note:
        "CPU/GPU frequency limits remain unchanged. Thermal behavior is managed by Xiaomi Parts."
    },
    Performance: {
      description:
        "Prioritizes CPU responsiveness using the performance governor.",
      cpu: "performance",
      io: "mq-deadline",
      note:
        "May increase CPU frequencies, power consumption and heat. " +
        "Frequency limits and thermal settings are not modified."
    },
    Experimental: {
      description:
        "Create a custom CPU and I/O configuration using supported kernel options.",
      cpu: "",
      io: "",
      note:
        "Advanced mode. No CPU/GPU frequency limits or thermal settings are changed."
    }
  };


  function render() {
    const isExperimental = selected === "Experimental";

    experimentalPanel.hidden = !isExperimental;
    experimentalCpu.disabled = busy || customBusy || !customReady;
    experimentalIo.disabled = busy || customBusy || !customReady;
    experimentalXiaomi.disabled = busy || customBusy;

    recoveryCpu.disabled =
      busy || customBusy || recoveryBusy || !customCpuOptions.length;
    recoveryIo.disabled =
      busy || customBusy || recoveryBusy || !customIoOptions.length;

    const recoveryCpuValid =
      recoveryCpu.value === "keep" ||
      customCpuOptions.includes(recoveryCpu.value);

    const recoveryIoValid =
      recoveryIo.value === "keep" ||
      customIoOptions.includes(recoveryIo.value);

    recoveryApply.disabled =
      busy || customBusy || recoveryBusy || !ENABLE_WRITES ||
      !recoveryCpuValid || !recoveryIoValid ||
      (recoveryCpu.value === "keep" && recoveryIo.value === "keep");


    if (companionStatus && companionDetail) {
      if (companionAvailable) {
        companionStatus.textContent = companionProfile
          ? `Connected · ${companionProfile}`
          : "Connected";
        companionStatus.dataset.state = "connected";
        companionDetail.textContent =
          "Xiaomi Parts synchronization is available for supported profiles.";
      } else {
        companionStatus.textContent = "Unavailable";
        companionStatus.dataset.state = "unavailable";
        companionDetail.textContent =
          "Kernel profiles remain available. Xiaomi Parts synchronization is disabled.";
      }
    }

    const info = profileDescriptions[selected];

    document.getElementById("profile-details-title").textContent =
      selected;

    document.getElementById("profile-details-description").textContent =
      info.description;

    document.getElementById("profile-details-cpu").textContent =
      info.cpu;

    document.getElementById("profile-details-io").textContent =
      info.io;

    document.getElementById("profile-details-note").textContent =
      info.note;

    document.getElementById("profile-details-specs").hidden =
      selected === "Experimental" ||
      !supportedProfiles.includes(selected);

    for (const button of choices) {
      const active = button.dataset.profile === selected;

      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", String(active));
    }

    const supported = supportedProfiles.includes(selected);

    if (applyButton) {
      applyButton.textContent = selected === "Experimental"
        ? "Apply Custom"
        : `Apply ${selected}`;
      applyButton.disabled =
        busy || recoveryBusy || !compatible || !supported || !ENABLE_WRITES ||
        (selected === "Experimental" && (!customReady || customBusy));
    }

    if (refreshButton) {
      refreshButton.disabled = busy;
    }
  }

  function parseStatus(raw) {
    const cpu = [...raw.matchAll(/^policy\d+:\s*(\S+)/gm)]
      .map(match => match[1]);

    const io = [...raw.matchAll(/^sd[a-z]+:\s*(\S+)/gm)]
      .map(match => match[1]);

    if (!cpu.length || !io.length) {
      return {
        name: "Unknown",
        detail: "Incomplete CPU or I/O information"
      };
    }

    const allEqual = (values, expected) =>
      values.every(value => value === expected);

    const balanced =
      allEqual(cpu, "schedutil") && allEqual(io, "kyber");

    const native =
      allEqual(cpu, "sugov_ext") && allEqual(io, "none");

    const battery =
      allEqual(cpu, "conservative") && allEqual(io, "none");

    const performanceProfile =
      allEqual(cpu, "performance") && allEqual(io, "mq-deadline");

    return {
      cpu,
      io,
      name: balanced
        ? "Balanced"
        : native
          ? "Native"
          : battery
            ? "Battery Saver"
            : performanceProfile
              ? "Performance"
              : "Custom / mixed",
      detail:
        `CPU: ${[...new Set(cpu)].join(", ")} · ` +
        `I/O: ${[...new Set(io)].join(", ")}`
    };
  }

  async function execute(action) {
    if (!window.HearthrootBridge?.execute) {
      throw new Error("BakaSU bridge unavailable");
    }

    return window.HearthrootBridge.execute(
      `/system/bin/sh ${MODULE_SCRIPT} ${action}`,
      30000
    );
  }


  const INTEGRATED_SCRIPT =
    "/data/adb/modules/hearthroot.control/scripts/apply-integrated.sh";
  async function executeIntegrated(action) {
    if (!window.HearthrootBridge?.execute) {
      throw new Error("BakaSU bridge unavailable");
    }
    return window.HearthrootBridge.execute(
      `/system/bin/sh ${INTEGRATED_SCRIPT} ${action}`, 45000
    );
  }


  // Companion availability is confirmed through a live Xiaomi Parts QUERY.
  const XIAOMI_SCRIPT =
    "/data/adb/modules/hearthroot.control/scripts/xiaomi-sync.sh";

  let companionAvailable = false;
  let companionProfile = null;
  let companionQuery = null;

  async function refreshCompanionState() {
    if (companionQuery) return companionQuery;

    companionQuery = (async () => {
      companionAvailable = false;
      companionProfile = null;
      render();

      try {
      if (!window.HearthrootBridge?.execute) {
        return;
      }

      const result = await window.HearthrootBridge.execute(
        `/system/bin/sh ${XIAOMI_SCRIPT} QUERY`,
        15000
      );

      if (result.exitCode !== undefined && result.exitCode !== 0) {
        throw new Error("Companion QUERY returned a failure");
      }

      const match = (result.stdout || "").match(
        /^XIAOMI_PROFILE=(NORMAL|ECONOMY|BOOST|EXTREME|CUSTOM)$/m
      );

      if (match) {
        companionAvailable = true;
        companionProfile = match[1];
      }
    } catch (error) {
      console.warn("Companion unavailable:", error);
      } finally {
        render();
      }
    })();

    try {
      return await companionQuery;
    } finally {
      companionQuery = null;
    }
  }

  async function loadCustomOptions() {
    if (customBusy) return;

    customBusy = true;
    customReady = false;
    render();

    try {
      const result = await execute("options");
      const lines = result.stdout.split(/\r?\n/);

      const cpuLine = lines.find(line => line.startsWith("CPU="));
      const ioLine = lines.find(line => line.startsWith("IO="));

      if (!cpuLine || !ioLine) {
        throw new Error("Kernel options could not be read");
      }

      const parse = line =>
        [...new Set(
          line.slice(3)
            .trim()
            .split(/\s+/)
            .filter(value => /^[a-zA-Z0-9_-]+$/.test(value))
        )];

      customCpuOptions = parse(cpuLine);
      customIoOptions = parse(ioLine);

      if (!customCpuOptions.length || !customIoOptions.length) {
        throw new Error("No compatible custom options found");
      }

      const fillSelect = (element, values) => {
        const previous = element.value;
        element.textContent = "";

        for (const value of values) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          element.appendChild(option);
        }

        if (values.includes(previous)) {
          element.value = previous;
        }
      };

      fillSelect(experimentalCpu, customCpuOptions);
      fillSelect(experimentalIo, customIoOptions);

      const fillRecoverySelect = (element, values) => {
        const previous = element.value;
        element.textContent = "";

        const keep = document.createElement("option");
        keep.value = "keep";
        keep.textContent = "Keep current";
        element.appendChild(keep);

        for (const value of values) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          element.appendChild(option);
        }

        element.value =
          previous === "keep" || values.includes(previous)
            ? previous
            : "keep";
      };

      fillRecoverySelect(recoveryCpu, customCpuOptions);
      fillRecoverySelect(recoveryIo, customIoOptions);

      if (savedCustomSelection) {
        if (customCpuOptions.includes(savedCustomSelection.cpu)) {
          experimentalCpu.value = savedCustomSelection.cpu;
        }

        if (customIoOptions.includes(savedCustomSelection.io)) {
          experimentalIo.value = savedCustomSelection.io;
        }

        savedCustomSelection = null;
      }

      customReady = true;

      if (selected === "Experimental") {
        progressMessage(
          "Custom settings ready. Select your options before applying."
        );
      }
    } catch (error) {
      customReady = false;

      if (selected === "Experimental") {
        progressMessage(
          `Could not load custom options: ${error.message}`,
          "error"
        );
      }
    } finally {
      customBusy = false;
      render();
    }
  }


  const BOOT_SCRIPT =
    "/data/adb/modules/hearthroot.control/scripts/boot-state.sh";

  const bootToggle = document.getElementById("boot-toggle");
  const bootState = document.getElementById("boot-state");

  /* Hearthroot Saved Selection Sync */
  let initialSelectionPending = true;
  let selectionTouched = false;
  let savedCustomSelection = null;

  async function executeBoot(action) {
    return window.HearthrootBridge.execute(
      `/system/bin/sh ${BOOT_SCRIPT} ${action}`,
      15000
    );
  }

  async function refreshBootState() {
    bootToggle.disabled = true;

    try {
      const result = await executeBoot("status");

      const enabled = /^BOOT=enabled$/m.test(result.stdout);
      const saved = result.stdout.match(/^SAVED=(.*)$/m);

      if (!saved) {
        throw new Error("Invalid boot state response");
      }

      const stored = saved[1].trim();

      if (initialSelectionPending) {
        initialSelectionPending = false;

        const parts = stored.split(/\s+/);
        const names = {
          native: "Native",
          balanced: "Balanced",
          battery: "Battery Saver",
          performance: "Performance",
          custom: "Experimental"
        };

        const restored = names[parts[0]];

        if (restored && !selectionTouched) {
          selected = restored;

          if (parts[0] === "custom" &&
              parts.length >= 3) {
            savedCustomSelection = {
              cpu: parts[1],
              io: parts[2]
            };

            if (parts.length >= 4 &&
                ["none", "normal", "economy", "boost"].includes(parts[3])) {
              experimentalXiaomi.value = parts[3];
            }
            if (customReady) {
              if (customCpuOptions.includes(parts[1])) {
                experimentalCpu.value = parts[1];
              }

              if (customIoOptions.includes(parts[2])) {
                experimentalIo.value = parts[2];
              }

              savedCustomSelection = null;
            } else {
              loadCustomOptions();
            }
          }

          render();

          progressMessage(
            `Last applied: ${restored}. ` +
            "Check the active kernel configuration for current values."
          );
        }
      }

      bootToggle.checked = enabled;
      bootToggle.disabled = stored === "none";

      bootState.textContent = enabled
        ? `Enabled · Saved profile: ${stored}`
        : stored === "none"
          ? "Apply a profile before enabling boot restoration."
          : `Disabled · Last saved: ${stored}`;

    } catch (error) {
      bootToggle.disabled = true;
      bootState.textContent =
        `Boot configuration unavailable: ${error.message}`;
    }
  }

  async function changeBootState() {
    const enable = bootToggle.checked;

    bootToggle.disabled = true;

    try {
      await executeBoot(enable ? "enable" : "disable");
      await refreshBootState();
    } catch (error) {
      await refreshBootState();
      bootState.textContent =
        `Could not change boot setting: ${error.message}`;
    }
  }

  /* Hearthroot Automatic Diagnostics */
  function refreshDiagnosticCards() {
    const button = document.getElementById("refresh-diagnostics");

    if (button && !button.disabled) {
      button.click();
    }
  }

  function syncKernelViews() {
    if (document.hidden) return;

    refreshStatus();
    refreshDiagnosticCards();
  }

  async function refreshStatus(refreshCompanion = true) {
    if (busy) return;

    busy = true;
    compatible = false;
    render();

    lastStatus = null;
    currentState.textContent = "Reading...";
    currentDetail.textContent = "Checking kernel interfaces";

    try {
      // Both commands are read-only.
      // Check compatibility and read kernel state in one root call.
      // Status runs only if compatibility validation succeeds.
      const result = await window.HearthrootBridge.execute(
        `/system/bin/sh ${MODULE_SCRIPT} check >/dev/null && ` +
        `/system/bin/sh ${MODULE_SCRIPT} status`,
        30000
      );
      const detected = parseStatus(result.stdout);
      lastStatus = detected;

      compatible = detected.name !== "Unknown";
      currentState.textContent = detected.name;
      currentDetail.textContent = detected.detail;

    } catch (error) {
      currentState.textContent = "Unavailable";
      currentDetail.textContent = error.message;
      progressMessage(
        "Unable to verify kernel configuration. No changes applied.",
        "error"
      );
    } finally {
      busy = false;

      if (refreshCompanion) {
        await refreshCompanionState();
      }

      render();
    }
  }


  async function applyRecovery() {
    if (!ENABLE_WRITES || busy || customBusy || recoveryBusy) return;

    const cpu = recoveryCpu.value;
    const io = recoveryIo.value;

    const cpuValid =
      cpu === "keep" || customCpuOptions.includes(cpu);

    const ioValid =
      io === "keep" || customIoOptions.includes(io);

    if (!cpuValid || !ioValid) {
      recoveryStatus.textContent = "Invalid recovery selection.";
      return;
    }

    if (cpu === "keep" && io === "keep") {
      recoveryStatus.textContent =
        "Choose at least one kernel setting to recover.";
      return;
    }

    recoveryBusy = true;
    render();

    const cpuLabel =
      cpu === "keep" ? "CPU unchanged" : `CPU ${cpu}`;

    const ioLabel =
      io === "keep" ? "I/O unchanged" : `I/O ${io}`;

    recoveryStatus.textContent =
      `Applying recovery: ${cpuLabel}, ${ioLabel}...`;

    try {
      const result = await executeIntegrated(
        `recovery ${cpu} ${io}`
      );

      if (!/^RECOVERY=OK$/m.test(result.stdout || "")) {
        throw new Error("Recovery operation was not confirmed");
      }

      await refreshStatus(false);

      recoveryStatus.textContent =
        `Recovery applied: ${cpuLabel}, ${ioLabel}. ` +
        "Xiaomi Parts and boot settings were not modified.";
    } catch (error) {
      recoveryStatus.textContent =
        `Recovery failed: ${error.message}. Check active kernel values.`;
    } finally {
      recoveryBusy = false;
      render();
    }
  }

  async function applyProfile() {
    if (!ENABLE_WRITES || busy || recoveryBusy || !compatible) return;
    if (!supportedProfiles.includes(selected)) return;

    const actions = {
      Balanced: "balanced",
      Native: "native",
      "Battery Saver": "battery",
      Performance: "performance"
    };

    const requested = selected;
    let action = actions[selected];
    let requestedCpu = "";
    let requestedIo = "";
    let requestedXiaomi = "none";

    if (selected === "Experimental") {
      if (!customReady || customBusy) return;

      requestedCpu = experimentalCpu.value;
      requestedIo = experimentalIo.value;

      if (!customCpuOptions.includes(requestedCpu) ||
          !customIoOptions.includes(requestedIo)) {
        progressMessage("Invalid custom selection.", "error");
        return;
      }

      requestedXiaomi = experimentalXiaomi.value;
      if (!["none", "normal", "economy", "boost"].includes(requestedXiaomi)) {
        progressMessage("Invalid Xiaomi Parts selection.", "error");
        return;
      }
      action = `custom ${requestedCpu} ${requestedIo} ${requestedXiaomi}`;
    }

    if (!action) return;

    busy = true;
    render();
    progressFill.style.width = "";
    progressWorking();

    let commandError = null;
    let syncState = "";
    try {
      const result = await executeIntegrated(action);
      syncState = result.stdout?.match(/^XIAOMI_SYNC=(.+)$/m)?.[1] || "UNCONFIRMED";
      progressStage("Kernel command completed. Checking active settings...");
    } catch (error) {
      commandError = error;
    } finally {
      busy = false;

      // The integrated backend already reports the Xiaomi synchronization
      // result. Avoid an immediate duplicate Companion QUERY after Apply.
      if (!commandError) {
        const syncMatch = syncState.match(/^OK:(NORMAL|ECONOMY|BOOST)$/);

        if (syncMatch) {
          companionAvailable = true;
          companionProfile = syncMatch[1];
        } else if (syncState === "SKIPPED:COMPANION_UNAVAILABLE") {
          companionAvailable = false;
          companionProfile = null;
        }
      }

      if (!commandError) {
        progressStage("Verifying CPU, I/O and Xiaomi Parts...");
      }
      await refreshStatus(false);
      refreshDiagnosticCards();
    }

    if (commandError) {
      progressFinish(
        `Apply failed: ${commandError.message}. Check active values.`,
        false
      );
      return;
    }

    if (!lastStatus || !compatible) {
      progressFinish(
        `Unable to verify ${requested}. Check the active kernel configuration.`,
        false
      );
      return;
    }

    let verified = lastStatus.name === requested;

    if (requested === "Experimental") {
      verified = Boolean(
        lastStatus?.cpu?.length &&
        lastStatus?.io?.length &&
        lastStatus.cpu.every(value => value === requestedCpu) &&
        lastStatus.io.every(value => value === requestedIo)
      );
    }


    const expectedXiaomi = requested === "Experimental"
      ? {
          none: null,
          normal: "NORMAL",
          economy: "ECONOMY",
          boost: "BOOST"
        }[requestedXiaomi]
      : {
          Native: "NORMAL",
          Balanced: "NORMAL",
          "Battery Saver": "ECONOMY",
          Performance: "BOOST"
        }[selected];

    const companionSkipped =
      syncState === "SKIPPED:COMPANION_UNAVAILABLE";

    const syncVerified = expectedXiaomi === null
      ? syncState === "SKIPPED:NO_SYNC_REQUESTED"
      : syncState === `OK:${expectedXiaomi}` || companionSkipped;

    if (verified && syncVerified) {
      try {
        progressStage("Saving boot configuration...");
        await executeBoot(`save ${action}`);
        await refreshBootState();
      } catch (error) {
        progressFinish(
          `${requested} verified, but could not save boot state: ` +
          error.message,
          false
        );
        return;
      }
    }

    const finalMessage = verified && syncVerified
      ? `${requested} settings verified as active. Xiaomi Parts: ${syncState}.`
      : verified
        ? `${requested} kernel settings applied, but Xiaomi Parts synchronization is not confirmed (${syncState}). Profile not saved.`
        : `Settings do not fully match ${requested}. Check diagnostics. Xiaomi Parts: ${syncState}.`;

    progressFinish(finalMessage, verified && syncVerified);
  }

  for (const button of choices) {
    button.addEventListener("click", () => {
      selectionTouched = true;
      selected = button.dataset.profile;



      render();

      // Profile selection only updates the UI.
      // Kernel state is read on startup, Refresh and after Apply.
      if (selected === "Experimental" && !customReady) {
        loadCustomOptions();
      }
    });
  }

  bootToggle.addEventListener("change", changeBootState);

  refreshButton?.addEventListener("click", refreshStatus);
  applyButton?.addEventListener("click", applyProfile);
  recoveryApply?.addEventListener("click", applyRecovery);
  recoveryCpu?.addEventListener("change", render);
  recoveryIo?.addEventListener("change", render);

  experimentalCpu?.addEventListener("change", render);
  experimentalIo?.addEventListener("change", render);

  render();
  refreshBootState();
  refreshStatus();
  loadCustomOptions();

  // One delayed refresh for recently booted devices.
  setTimeout(syncKernelViews, 30000);

  // Refresh when returning from another app.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncKernelViews();
    }
  });

  window.addEventListener("pageshow", event => {
    if (event.persisted) {
      syncKernelViews();
    }
  });
})();
