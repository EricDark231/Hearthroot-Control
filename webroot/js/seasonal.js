/*
 * Hearthroot Seasonal Themes
 * Automatic calendar detection and manual preview.
 * No kernel modifications.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "hearthroot.seasonal.theme";
  const VALID_THEMES = ["auto", "default", "halloween", "christmas"];

  const THEMES = {
    default: {
      name: "Moonlit Cottage",
      subtitle: "A quiet place to tend your kernel."
    },
    halloween: {
      name: "Haunted Cottage",
      subtitle: "Even the quietest forests have their secrets."
    },
    christmas: {
      name: "Winter Cottage",
      subtitle: "A little warmth beneath the winter stars."
    }
  };

  function getAutomaticTheme(date = new Date()) {
    const month = date.getMonth();

    if (month === 9) return "halloween";
    if (month === 11) return "christmas";

    return "default";
  }

  function getPreference() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return VALID_THEMES.includes(saved) ? saved : "auto";
    } catch {
      return "auto";
    }
  }

  function savePreference(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Storage may be unavailable in some WebViews.
    }
  }

  function applyTheme(preference) {
    const theme = preference === "auto"
      ? getAutomaticTheme()
      : preference;

    const selected = THEMES[theme] ? theme : "default";

    document.documentElement.dataset.season = selected;

    const name = document.getElementById("season-name");
    const tagline = document.querySelector(".tagline");
    const select = document.getElementById("season-select");

    if (name) name.textContent = THEMES[selected].name;
    if (tagline) tagline.textContent = THEMES[selected].subtitle;
    if (select) select.value = preference;

    return selected;
  }

  function init() {
    const select = document.getElementById("season-select");

    applyTheme(getPreference());

    if (select) {
      select.addEventListener("change", () => {
        const preference = VALID_THEMES.includes(select.value)
          ? select.value
          : "auto";

        savePreference(preference);
        applyTheme(preference);
      });
    }

    // Refresh the automatic theme when returning to the WebUI.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && getPreference() === "auto") {
        applyTheme("auto");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
