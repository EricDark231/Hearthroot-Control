"use strict";

(() => {
  const trigger = document.getElementById(
    "hearth-settings-trigger"
  );

  const panel = document.getElementById(
    "hearth-settings-panel"
  );

  if (!trigger || !panel) return;

  function setOpen(open) {
    panel.hidden = !open;

    trigger.setAttribute(
      "aria-expanded",
      String(open)
    );

    trigger.setAttribute(
      "aria-label",
      open ? "Close settings" : "Open settings"
    );
  }

  trigger.addEventListener("click", () => {
    setOpen(panel.hidden);
  });

  // Close when touching outside the menu.
  document.addEventListener("pointerdown", event => {
    if (panel.hidden) return;

    if (
      !panel.contains(event.target) &&
      !trigger.contains(event.target)
    ) {
      setOpen(false);
    }
  });

  // Keyboard accessibility.
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      trigger.focus();
    }
  });

  setOpen(false);
})();
