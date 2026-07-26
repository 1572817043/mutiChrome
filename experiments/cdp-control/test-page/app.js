const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "normal";
const controls = document.querySelector("#controls");
const log = document.querySelector("#status-log");
let clicks = 0;

document.querySelector("#url-display").textContent = window.location.href;

function appendLog(message) {
  log.textContent += `${new Date().toISOString()} ${message}\n`;
}

if (mode !== "missing-button") {
  const button = document.createElement("button");
  button.id = "primary-action";
  button.type = "button";
  button.textContent = "Primary action";
  button.addEventListener("click", () => {
    clicks += 1;
    document.querySelector("#click-count").textContent = `clicks: ${clicks}`;
    appendLog("button clicked");
  });
  controls.append(button);
}

if (mode !== "missing-input") {
  const input = document.createElement("input");
  input.id = "message-input";
  input.type = "text";
  input.placeholder = "message";
  input.addEventListener("input", () => {
    document.querySelector("#typed-output").textContent = `typed: ${input.value}`;
    appendLog(`input changed: ${input.value}`);
  });
  controls.append(input);
}
