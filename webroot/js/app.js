"use strict";

(() => {
  const MODULE_SCRIPT =
    "/data/adb/modules/hearthroot.control/scripts/profiles.sh";

  // Enable only after read-only testing on the device.
  const ENABLE_WRITES = true;

  const choices = [...document.querySelectorAll(".choice")];
  const notice = document.getElementById("preview-status");
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
        "CPU/GPU frequency limits and thermal settings remain unchanged."
    },
    Native: {
      description:
        "Restores Hearthroot Kernel's native CPU governor and I/O scheduler.",
      cpu: "sugov_ext",
      io: "none",
      note:
        "CPU/GPU frequency limits and thermal settings remain unchanged."
    },
    "Battery Saver": {
      description:
        "A lighter CPU scaling policy with native I/O scheduling.",
      cpu: "conservative",
      io: "none",
      note:
        "CPU/GPU frequency limits and thermal settings remain unchanged."
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
        busy || !compatible || !supported || !ENABLE_WRITES ||
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
        notice.textContent =
          "Custom settings ready. Select your options before applying.";
      }
    } catch (error) {
      customReady = false;

      if (selected === "Experimental") {
        notice.textContent =
          `Could not load custom options: ${error.message}`;
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
              parts.length === 3) {
            savedCustomSelection = {
              cpu: parts[1],
              io: parts[2]
            };

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

          notice.textContent =
            `Last applied: ${restored}. ` +
            "Check the active kernel configuration " +
            "for current values.";
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

  async function refreshStatus() {
    if (busy) return;

    busy = true;
    compatible = false;
    render();

    lastStatus = null;
    currentState.textContent = "Reading...";
    currentDetail.textContent = "Checking kernel interfaces";

    try {
      // Both commands are read-only.
      await execute("check");

      const result = await execute("status");
      const detected = parseStatus(result.stdout);
      lastStatus = detected;

      compatible = detected.name !== "Unknown";
      currentState.textContent = detected.name;
      currentDetail.textContent = detected.detail;

    } catch (error) {
      currentState.textContent = "Unavailable";
      currentDetail.textContent = error.message;
      notice.textContent =
        "Unable to verify kernel configuration. No changes applied.";
    } finally {
      busy = false;
      render();
    }
  }

  async function applyProfile() {
    if (!ENABLE_WRITES || busy || !compatible) return;
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

    if (selected === "Experimental") {
      if (!customReady || customBusy) return;

      requestedCpu = experimentalCpu.value;
      requestedIo = experimentalIo.value;

      if (!customCpuOptions.includes(requestedCpu) ||
          !customIoOptions.includes(requestedIo)) {
        notice.textContent = "Invalid custom selection.";
        return;
      }

      action = `custom ${requestedCpu} ${requestedIo}`;
    }

    if (!action) return;

    busy = true;
    render();
    notice.textContent = `Applying ${requested}...`;

    let commandError = null;

    try {
      await execute(action);
    } catch (error) {
      commandError = error;
    } finally {
      busy = false;
      await refreshStatus();
      refreshDiagnosticCards();
    }

    if (commandError) {
      notice.textContent =
        `Apply failed: ${commandError.message}. Check active values.`;
      return;
    }

    let verified = lastStatus?.name === requested;

    if (requested === "Experimental") {
      verified = Boolean(
        lastStatus?.cpu?.length &&
        lastStatus?.io?.length &&
        lastStatus.cpu.every(value => value === requestedCpu) &&
        lastStatus.io.every(value => value === requestedIo)
      );
    }


    if (verified) {
      try {
        await executeBoot(`save ${action}`);
        await refreshBootState();
      } catch (error) {
        notice.textContent =
          `${requested} verified, but could not save boot state: ` +
          error.message;
        return;
      }
    }

    notice.textContent = verified
      ? `${requested} settings verified as active.`
      : `Settings do not fully match ${requested}. Check diagnostics.`;
  }

  for (const button of choices) {
    button.addEventListener("click", () => {
      selectionTouched = true;
      selected = button.dataset.profile;

      notice.textContent =
        supportedProfiles.includes(selected)
          ? `${selected} selected. No changes applied.`
          : `${selected} is not implemented yet.`;

      render();

      syncKernelViews();

      if (selected === "Experimental" && !customReady) {
        loadCustomOptions();
      }
    });
  }

  bootToggle.addEventListener("change", changeBootState);

  refreshButton?.addEventListener("click", refreshStatus);
  applyButton?.addEventListener("click", applyProfile);

  experimentalCpu?.addEventListener("change", render);
  experimentalIo?.addEventListener("change", render);

  render();
  refreshBootState();
  refreshStatus();

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
