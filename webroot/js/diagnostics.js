"use strict";

(() => {
  const COMMAND = `
echo '=== KERNEL ==='
uname -r
uname -v

echo '=== DEVICE ==='
getprop ro.product.device
getprop ro.product.model
getprop ro.build.version.release
getprop ro.build.version.sdk

echo '=== CPU ==='
for p in /sys/devices/system/cpu/cpufreq/policy*; do
  [ -d "$p" ] || continue
  echo "POLICY: $(basename "$p")"
  for f in scaling_governor scaling_available_governors related_cpus scaling_min_freq scaling_max_freq cpuinfo_max_freq; do
    [ -r "$p/$f" ] && echo "$f: $(cat "$p/$f")"
  done
done

echo '=== IO ==='
for d in /sys/block/sd*; do
  [ -d "$d" ] || continue
  echo "DEVICE: $(basename "$d")"
  [ -r "$d/queue/scheduler" ] && cat "$d/queue/scheduler"
  [ -r "$d/queue/read_ahead_kb" ] && echo "read_ahead_kb: $(cat "$d/queue/read_ahead_kb")"
done

echo '=== MEMORY ==='
grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo

echo '=== ZRAM ==='
for z in /sys/block/zram*; do
  [ -d "$z" ] || continue
  echo "DEVICE: $(basename "$z")"
  [ -r "$z/comp_algorithm" ] && cat "$z/comp_algorithm"
  [ -r "$z/disksize" ] && echo "disksize: $(cat "$z/disksize")"
done

echo '=== ROOT ==='
id

echo '=== END ==='
`;

  const sections = [
    ["KERNEL", "Kernel", "leaf"],
    ["DEVICE", "Device", "phone"],
    ["CPU", "CPU Governors", "cpu"],
    ["IO", "I/O Schedulers", "drive"],
    ["MEMORY", "Memory", "memory"],
    ["ZRAM", "ZRAM", "memory"],
    ["ROOT", "Root Access", "shield"]
  ];

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function parseSections(raw) {
    const data = {};
    let current = null;

    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^=== ([A-Z]+) ===$/);

      if (match) {
        current = match[1];
        data[current] = [];
      } else if (current && current !== "END") {
        data[current].push(line);
      }
    }

    return data;
  }

  function formatSection(name, lines) {
    const content = lines.filter(line => line.trim());

    if (!content.length) {
      return '<span class="diag-muted">Unavailable</span>';
    }

    if (name === "KERNEL") {
      return `
        <strong>${escapeHTML(content[0])}</strong>
        <span class="diag-muted">${escapeHTML(content[1] || "")}</span>
      `;
    }

    if (name === "DEVICE") {
      return `
        <strong>${escapeHTML(content[1] || content[0])}</strong>
        <span>${escapeHTML(content[0] || "")}</span>
        <span class="diag-muted">
          Android ${escapeHTML(content[2] || "?")}
          · API ${escapeHTML(content[3] || "?")}
        </span>
      `;
    }

    if (name === "CPU") {
      const policies = [];
      let current = null;

      for (const line of content) {
        if (line.startsWith("POLICY:")) {
          current = { name: line.split(":")[1].trim() };
          policies.push(current);
        } else if (current) {
          const index = line.indexOf(":");
          if (index > 0) {
            current[line.slice(0, index).trim()] =
              line.slice(index + 1).trim();
          }
        }
      }

      return policies.map(policy => `
        <div class="diag-entry">
          <strong>${escapeHTML(policy.name)}</strong>
          <span>
            Active:
            <b>${escapeHTML(policy.scaling_governor || "?")}</b>
          </span>
          <span class="diag-muted">
            Available:
            ${escapeHTML(policy.scaling_available_governors || "?")}
          </span>
        </div>
      `).join("");
    }

    if (name === "IO") {
      const devices = [];
      let current = null;

      for (const line of content) {
        if (line.startsWith("DEVICE:")) {
          current = { name: line.split(":")[1].trim(), lines: [] };
          devices.push(current);
        } else if (current) {
          current.lines.push(line);
        }
      }

      return devices.map(device => {
        const scheduler = device.lines.find(
          line => line.includes("[")
        ) || "";

        const active = scheduler.match(/\[([^\]]+)\]/);

        return `
          <div class="diag-entry">
            <strong>${escapeHTML(device.name)}</strong>
            <span>
              Active:
              <b>${escapeHTML(active ? active[1] : "?")}</b>
            </span>
            <span class="diag-muted">
              Available:
              ${escapeHTML(scheduler.replace(/[\[\]]/g, ""))}
            </span>
          </div>
        `;
      }).join("");
    }

    if (name === "ROOT") {
      return `
        <strong>${content[0].includes("uid=0")
          ? "Root access granted"
          : "Root status unknown"}</strong>
        <span class="diag-muted">
          ${escapeHTML(content[0])}
        </span>
      `;
    }

    return content.map(line => `
      <span>${escapeHTML(line)}</span>
    `).join("");
  }

  function createPanel() {
    const section = document.createElement("section");
    section.className = "diagnostics";

    section.innerHTML = `
      <div class="diag-header">
        <small>THE ROOTS BENEATH</small>
        <h2>System Diagnostics</h2>
        <p id="diagnostic-status" role="status">
          Waiting for BakaSU...
        </p>
      </div>

      <div class="diag-grid" id="diagnostic-grid">
        ${sections.map(([key, title]) => `
          <article class="diag-card glass">
            <div class="diag-card-title">
              <span class="diag-leaf">❧</span>
              <h3>${title}</h3>
            </div>
            <div class="diag-card-body"
                 id="diag-${key.toLowerCase()}">
              <span class="diag-muted">Waiting...</span>
            </div>
          </article>
        `).join("")}
      </div>

      <details class="diag-raw glass">
        <summary>Full diagnostic log</summary>
        <pre id="diagnostic-output"></pre>
      </details>

      <button type="button"
              id="refresh-diagnostics"
              class="diag-refresh">
        Refresh diagnostics
      </button>
    `;

    document.querySelector(".profiles")?.after(section);
  }

  async function runDiagnostics() {
    const status = document.getElementById("diagnostic-status");
    const output = document.getElementById("diagnostic-output");
    const refresh = document.getElementById("refresh-diagnostics");

    if (!status || !output || !refresh) return;

    refresh.disabled = true;
    status.textContent = "Reading system information...";

    try {
      const result = await window.HearthrootBridge.execute(
        COMMAND, 30000
      );

      const raw = result.stdout;
      const parsed = parseSections(raw);

      output.textContent = raw;

      for (const [key] of sections) {
        const target = document.getElementById(
          `diag-${key.toLowerCase()}`
        );

        if (target) {
          target.innerHTML = formatSection(
            key,
            parsed[key] || []
          );
        }
      }

      status.textContent = raw.includes("=== END ===")
        ? "Diagnostics completed."
        : "Diagnostics returned incomplete data.";

    } catch (error) {
      status.textContent = "Diagnostics failed.";
      output.textContent = error.message;
    } finally {
      refresh.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    createPanel();

    document.getElementById("refresh-diagnostics")
      ?.addEventListener("click", runDiagnostics);

    runDiagnostics();
  });
})();
