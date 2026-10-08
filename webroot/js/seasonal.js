(() => {
  "use strict";

  const STORAGE_KEY = "hearthroot.seasonal.theme";

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
    },
    "new-year": {
      name: "Midnight Cottage",
      subtitle: "A new year beneath a thousand stars."
    },
    valentine: {
      name: "Rosewood Cottage",
      subtitle: "A little warmth for every heart."
    },
    easter: {
      name: "Blooming Cottage",
      subtitle: "Spring brings a little magic."
    },
    summer: {
      name: "Sunlit Cottage",
      subtitle: "Golden days beside the sea."
    },
    tanabata: {
      name: "Starlit Cottage",
      subtitle: "A thousand wishes beneath the stars."
    },
    autumn: {
      name: "Harvest Cottage",
      subtitle: "Where golden leaves find their way home."
    }
  };

  const VALID_THEMES = ["auto", ...Object.keys(THEMES)];

  function getWesternEaster(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k + 7) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    return new Date(year, month - 1, day);
  }

  function getAutomaticTheme(date = new Date()) {
    const month = date.getMonth();
    const day = date.getDate();

    if ((month === 11 && day === 31) ||
        (month === 0 && day === 1)) {
      return "new-year";
    }

    if (month === 1 && day <= 14) {
      return "valentine";
    }

    const today = new Date(
      date.getFullYear(),
      month,
      day
    );

    const easter = getWesternEaster(date.getFullYear());
    const easterStart = new Date(easter);
    easterStart.setDate(easterStart.getDate() - 6);

    if (today >= easterStart && today <= easter) {
      return "easter";
    }

    if (month === 6 && day === 7) {
      return "tanabata";
    }

    if (month === 9) {
      return "halloween";
    }

    if (month === 11) {
      return "christmas";
    }

    return "default";
  }

  function getPreference() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return VALID_THEMES.includes(value) ? value : "auto";
    } catch (_) {
      return "auto";
    }
  }

  function savePreference(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {
      // The theme still works without persistent storage.
    }
  }

  function applyTheme(preference) {
    const selected = VALID_THEMES.includes(preference)
      ? preference
      : "auto";

    const effective = selected === "auto"
      ? getAutomaticTheme()
      : selected;

    const theme = THEMES[effective] || THEMES.default;

    document.documentElement.dataset.season = effective;

    const name = document.getElementById("season-name");
    const tagline = document.querySelector(".tagline");
    const select = document.getElementById("season-select");

    if (name) name.textContent = theme.name;
    if (tagline) tagline.textContent = theme.subtitle;
    if (select) select.value = selected;
  }

  function init() {
    applyTheme(getPreference());

    const select = document.getElementById("season-select");

    if (select) {
      select.addEventListener("change", () => {
        savePreference(select.value);
        applyTheme(select.value);
      });
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && getPreference() === "auto") {
        applyTheme("auto");
      }
    });

    window.addEventListener("pageshow", () => {
      if (getPreference() === "auto") {
        applyTheme("auto");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
