"use strict";

window.HearthrootBridge = {
  execute(command, timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (typeof window.ksu?.exec !== "function") {
        reject(new Error("BakaSU bridge unavailable"));
        return;
      }

      const callbackName =
        "hearthrootCallback_" +
        Math.random().toString(36).slice(2);

      let finished = false;

      const cleanup = () => {
        finished = true;
        clearTimeout(timer);
        delete window[callbackName];
      };

      const timer = setTimeout(() => {
        if (finished) return;
        cleanup();
        reject(new Error("Command execution timed out"));
      }, timeout);

      window[callbackName] = (errno, stdout, stderr) => {
        if (finished) return;

        cleanup();

        const result = {
          errno: Number(errno),
          stdout: String(stdout || ""),
          stderr: String(stderr || "")
        };

        if (result.errno === 0) {
          resolve(result);
        } else {
          reject(
            new Error(
              result.stderr ||
              `Command failed: ${result.errno}`
            )
          );
        }
      };

      try {
        window.ksu.exec(command, "{}", callbackName);
      } catch (error) {
        if (!finished) {
          cleanup();
          reject(error);
        }
      }
    });
  }
};
