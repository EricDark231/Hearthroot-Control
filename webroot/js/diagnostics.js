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
    ["ZRAM", "ZRAM", "memory"]
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

    const safe = escapeHTML;

    if (name === "KERNEL") {
      return `<strong class="diag-value">${safe(content[0])}</strong>`;
    }

    if (name === "DEVICE") {
      return `
        <strong class="diag-value">${safe(content[1] || content[0])}</strong>
        <span class="diag-muted">${safe(content[0] || "")}</span>
        <span class="diag-muted">Android ${safe(content[2] || "?")}</span>
      `;
    }

    if (name === "CPU") {
      const governors = new Set();
      const active = new Set();

      for (const line of content) {
        if (line.startsWith("scaling_available_governors:")) {
          const values = line.split(":").slice(1).join(":").trim();
          values.split(/\s+/).filter(Boolean)
            .forEach(value => governors.add(value));
        }

        if (line.startsWith("scaling_governor:")) {
          const value = line.split(":").slice(1).join(":").trim();
          if (value) {
            active.add(value);
            governors.add(value);
          }
        }
      }

      if (!governors.size) {
        return '<span class="diag-muted">Unavailable</span>';
      }

      return `<div class="diag-tags">${[...governors].map(value => {
        const enabled = active.has(value);
        const label = enabled
          ? `<span class="diag-active-label">${
              active.size > 1 ? "In use" : "Active"
            }</span>`
          : "";

        return `<span class="diag-tag${enabled ? " is-active" : ""}">` +
          `${safe(value)}${label}</span>`;
      }).join("")}</div>`;
    }

    if (name === "IO") {
      const schedulers = new Set();
      const active = new Set();

      for (const line of content) {
        const current = line.match(/\[([^\]]+)\]/)?.[1];

        if (current) {
          active.add(current);
          schedulers.add(current);
        }

        if (/^\s*\[?[a-z][a-z0-9_-]*(?:\]?\s+|$)/i.test(line)
            && !line.includes(":")
            && !/^\d+$/.test(line.trim())) {
          line.replace(/[\[\]]/g, "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .forEach(value => schedulers.add(value));
        }
      }

      if (!schedulers.size) {
        return '<span class="diag-muted">Unavailable</span>';
      }

      return `<div class="diag-tags">${[...schedulers].map(value => {
        const enabled = active.has(value);
        const label = enabled
          ? `<span class="diag-active-label">${
              active.size > 1 ? "In use" : "Active"
            }</span>`
          : "";

        return `<span class="diag-tag${enabled ? " is-active" : ""}">` +
          `${safe(value)}${label}</span>`;
      }).join("")}</div>`;
    }

    if (name === "MEMORY") {
      const find = key => {
        const line = content.find(v => v.startsWith(key + ":"));
        return line ? Number(line.match(/\d+/)?.[0]) : NaN;
      };

      const total = find("MemTotal");
      const available = find("MemAvailable");
      const gib = kb => (kb / 1048576).toFixed(2);

      return `
        <strong class="diag-value">
          ${Number.isFinite(total) ? gib(total) + " GiB" : "Unavailable"}
        </strong>
        <span class="diag-muted">
          ${Number.isFinite(available)
            ? gib(available) + " GiB available"
            : ""}
        </span>
      `;
    }

    if (name === "ZRAM") {
      const algorithms = content.find(line => /\[[^\]]+\]/.test(line));
      const active = algorithms?.match(/\[([^\]]+)\]/)?.[1];
      const sizeLine = content.find(line => /^\d+$/.test(line.trim())
        || line.startsWith("disksize:"));
      const size = sizeLine ? Number(sizeLine.match(/\d+/)?.[0]) : NaN;

      return `
        <strong class="diag-value">
          ${Number.isFinite(size) ? (size / 1073741824).toFixed(2) + " GiB" : "Unavailable"}
        </strong>
        <span class="diag-muted">
          ${active ? "Compression: " + safe(active) : ""}
        </span>
      `;
    }

    if (name === "ROOT") {
      const granted = content.some(line => /\buid=0\(root\)/.test(line));
      return `<strong class="diag-value">
        ${granted ? "Access granted" : "Not confirmed"}
      </strong>`;
    }

    return '<span class="diag-muted">Unavailable</span>';
  }


  function activeCpuGovernor(lines) {
    const values = lines
      .filter(line => line.startsWith("scaling_governor:"))
      .map(line => line.split(":").slice(1).join(":").trim())
      .filter(Boolean);

    const unique = [...new Set(values)];

    if (!unique.length) return "Unavailable";
    return unique.length === 1 ? unique[0] : "Mixed";
  }

  function activeIoScheduler(lines) {
    const values = lines
      .map(line => line.match(/\[([^\]]+)\]/)?.[1])
      .filter(Boolean);

    const unique = [...new Set(values)];

    if (!unique.length) return "Unavailable";
    return unique.length === 1 ? unique[0] : "Mixed";
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
    output.textContent = "";

    // Clear previous values before collecting fresh data.
    document.querySelectorAll(".diag-card-body").forEach(card => {
      card.textContent = "Reading...";
    });

    const activeCpu = document.getElementById("active-cpu-governor");
    const activeIo = document.getElementById("active-io-scheduler");

    if (activeCpu) activeCpu.textContent = "Reading...";
    if (activeIo) activeIo.textContent = "Reading...";

    try {
      const result = await window.HearthrootBridge.execute(
        COMMAND, 30000
      );

      const raw = result.stdout;
      const parsed = parseSections(raw);

      output.textContent = raw;

      if (activeCpu) {
        activeCpu.textContent = activeCpuGovernor(parsed.CPU || []);
      }

      if (activeIo) {
        activeIo.textContent = activeIoScheduler(parsed.IO || []);
      }

      // Update the main device panel using detected properties.
      const deviceLines = (parsed.DEVICE || [])
        .filter(line => line.trim());

      const model = document.getElementById("device-model");
      const codename = document.getElementById("device-codename");

      if (model) {
        model.textContent = deviceLines[1] || "Unknown device";
      }

      if (codename) {
        codename.textContent = deviceLines[0] || "Unknown codename";
      }

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
      status.textContent = "Diagnostics unavailable.";
      output.textContent = String(error?.message || error);

      document.querySelectorAll(".diag-card-body").forEach(card => {
        card.textContent = "Unavailable";
      });

      const cpu = document.getElementById("active-cpu-governor");
      const io = document.getElementById("active-io-scheduler");
      const model = document.getElementById("device-model");
      const codename = document.getElementById("device-codename");

      if (cpu) cpu.textContent = "Unavailable";
      if (io) io.textContent = "Unavailable";
      if (model) model.textContent = "Unavailable";
      if (codename) codename.textContent = "Detection failed";
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
