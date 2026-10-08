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

  let compatible = false;
  let busy = false;

  const supportedProfiles = ["Balanced", "Native"];

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
      description: "Coming soon. This profile is not implemented yet.",
      cpu: "",
      io: "",
      note: "No kernel changes are available."
    },
    Experimental: {
      description: "Coming soon. Advanced controls are not available yet.",
      cpu: "",
      io: "",
      note: "No kernel changes are available."
    }
  };


  function render() {

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
      !supportedProfiles.includes(selected);

    for (const button of choices) {
      const active = button.dataset.profile === selected;

      button.classList.toggle("selected", active);
      button.setAttribute("aria-pressed", String(active));
    }

    const supported = supportedProfiles.includes(selected);

    if (applyButton) {
      applyButton.textContent = `Apply ${selected}`;
      applyButton.disabled =
        busy || !compatible || !supported || !ENABLE_WRITES;
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

    return {
      name: balanced
        ? "Balanced"
        : native
          ? "Native"
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

  async function refreshStatus() {
    if (busy) return;

    busy = true;
    compatible = false;
    render();

    currentState.textContent = "Reading...";
    currentDetail.textContent = "Checking kernel interfaces";

    try {
      // Both commands are read-only.
      await execute("check");

      const result = await execute("status");
      const detected = parseStatus(result.stdout);

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

    const action = selected === "Balanced"
      ? "balanced"
      : "native";

    const requested = selected;

    busy = true;
    render();

    notice.textContent = `Applying ${requested}...`;

    try {
      await execute(action);
      notice.textContent =
        `${requested} command completed. Verifying kernel state...`;
    } catch (error) {
      notice.textContent =
        `Could not apply ${requested}: ${error.message}`;
    } finally {
      busy = false;
      await refreshStatus();
    }

    if (currentState.textContent === requested) {
      notice.textContent = `${requested} verified as active.`;
    } else if (notice.textContent.includes("command completed")) {
      notice.textContent =
        `The kernel does not fully match ${requested}. Check diagnostics.`;
    }
  }

  for (const button of choices) {
    button.addEventListener("click", () => {
      selected = button.dataset.profile;

      notice.textContent =
        supportedProfiles.includes(selected)
          ? `${selected} selected. No changes applied.`
          : `${selected} is not implemented yet.`;

      render();
    });
  }

  refreshButton?.addEventListener("click", refreshStatus);
  applyButton?.addEventListener("click", applyProfile);

  render();
  refreshStatus();
})();
