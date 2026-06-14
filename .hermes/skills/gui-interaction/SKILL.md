---
name: gui-interaction
description: Agent GUI interaction skill — observe, identify, and act on screen elements. Covers vision-first observation, structured GUI.md contracts, annotated screenshot feedback, and an idempotent action loop. Load when tasks involve desktop/web GUI automation.
version: "1.0"
tags: [gui, vision, screen, computer-use, ui-tars, pywinassistant]
---

# gui-interaction

Agent GUI interaction skill for desktop and web applications. The agent observes the screen, identifies interactive elements, selects actions from a standardized vocabulary, executes them, and verifies results — all in an idempotent loop.

## Preconditions

- Screen is accessible (local display, VNC, or screenshot file).
- Screenshot capture tool available: `scrot`, `xdotool`, `import`, or `mcp_linear` with screenshot attachment.
- VLM or multimodal model available for screenshot analysis (or structured GUI.md is available).
- Action execution tools: `xdotool` (X11), `pyautogui` (cross-platform), or platform-specific APIs.

## Core Patterns

### Pattern 1: Vision-First Observation

When no `GUI.md` contract exists, use pure vision:

1. **Capture**: Take a screenshot of the current screen state.
2. **Analyze**: Feed screenshot to VLM with the observation prompt below.
3. **Decide**: VLM returns structured element list + recommended action.
4. **Execute**: Run the action using available input tools.

**Observation prompt template:**

```
Analyze this screenshot and return a JSON object with:
- elements: array of detected interactive elements, each with {id, type, text, bounding_box, interactable}
- recommended_action: {type, target_element_id, parameters}
- confidence: float 0-1
- next_steps: [string] (what to do if this action succeeds/fails)

Available action types: click, type, hotkey, scroll, navigate, wait, done
```

### Pattern 2: Structured Contract Access (GUI.md)

When `GUI.md` (or `gui.json`) exists at the app root:

1. **Load contract**: Read `GUI.md` to discover element IDs, types, and available actions.
2. **Resolve element**: Map target to concrete screen coordinates using the element's locator.
3. **Execute action**: Use the element's declared action contract.
4. **Verify**: Confirm action effect via screenshot comparison.

This is the preferred path — deterministic and efficient.

### Pattern 3: Annotated Screenshot Feedback

Every GUI cycle returns an annotated screenshot showing:
- Detected element bounding boxes (green = clickable, yellow = input, red = error state)
- The selected action's target element highlighted (bright green pulse)
- A short text label explaining the action

This makes GUI interactions **traceable and debuggable**.

### Pattern 4: Idempotent Action Loop

```
for each cycle:
    1. capture screenshot
    2. parse elements (GUI.md if available, else VLM)
    3. select action
    4. execute action
    5. verify change (capture + compare)
    6. if no change and retries < 2: retry
    7. if no change and retries >= 2: try alternative action
    8. if task complete: return done
    9. if cycle_count > max_cycles: return timeout
```

### Pattern 5: State Vector Tracking

Maintain a compact state vector across GUI cycles:

```json
{
  "task": "description of goal",
  "steps_taken": 0,
  "last_action": null,
  "last_action_result": "success|failure|no_change",
  "confidence": 1.0,
  "pending": ["step1", "step2"],
  "max_cycles": 20
}
```

Update state after every cycle. Use state to avoid repeating actions and detect loops.

### Pattern 6: Graceful Degradation

Always attempt these levels in order:

| Level | Method | Reliability | When to Use |
|-------|--------|-------------|-------------|
| 1 | GUI.md + structured access | High (~95%) | Contract exists |
| 2 | Platform API + OCR | Medium (~85%) | Accessibility API available |
| 3 | Pure vision (VLM) | Lower (~70%) | Fallback for any screen |

---

## Action Vocabulary

All actions use this standardized set:

| Action | Parameters | Description |
|--------|-----------|-------------|
| `click` | `(x, y)` or `(element_id)` | Click at coordinates or on element |
| `type` | `(text, element_id?)` | Type text into focused element or specified element |
| `hotkey` | `(keys...)` | Press key combination (e.g., `ctrl+c`, `alt+tab`) |
| `scroll` | `(direction, amount)` | Scroll up/down/left/right (direction: "up", "down", "left", "right) |
| `wait` | `(ms)` | Wait for specified milliseconds |
| `navigate` | `(path)` | Navigate to path (URL, menu path, dialog name) |
| `done` | `()` | Terminal action — task complete |

---

## Usage

### Web GUI Interaction

```
1. Navigate to URL
2. Check for GUI.md at app root
3. If GUI.md exists: load contract, resolve element IDs
4. If not: capture screenshot, run VLM observation
5. Select action from vocabulary
6. Execute using WebDriver or pixel-level tools
7. Verify with screenshot comparison
8. Loop until task complete or max_cycles reached
```

### Desktop GUI Interaction (Linux/X11)

```
1. Capture screenshot: scrot / screenshot-tool
2. Run element detection: GUI.md lookup or VLM on screenshot
3. Execute action: xdotool click/mousemove/type or pyautogui equivalent
4. Verify: compare screenshots, check for UI state change
5. Loop until complete
```

### Desktop GUI Interaction (Windows)

```
1. Capture screenshot: pyautogui.screenshot()
2. Get element tree: UI Automation API (pywinauto)
3. Query elements by name/role/automation_id
4. Execute: pywinauto actions or pyautogui fallback
5. Verify: new screenshot or UIA state check
6. Loop until complete
```

---

## Implementation Example

### Step 1: Capture and Observe

```bash
# Capture screenshot
scrot /tmp/gui-screenshot.png

# Run VLM observation (pseudo-code)
result=$(vlm --model multimodal-model --image /tmp/gui-screenshot.png \
  --prompt "Analyze this screen and return {elements: [...], action: {...}, confidence: 0.9}")

echo "$result" | jq '.elements'
# [{id: "login-btn", type: "button", text: "Login", bbox: [800, 500, 900, 540]}]
echo "$result" | jq '.action'
# {type: "click", target_element_id: "login-btn"}
```

### Step 2: Execute Action

```bash
# For GUI.md contract (preferred):
element=$(jq -r '.elements[] | select(.id == "login-btn") | .locator' gui.md)
xdotool mousemove $(extract_x $element) $(extract_y $element) && xdotool click 1

# For pure vision:
x=850 y=520
xdotool mousemove $x $y && xdotool click 1
```

### Step 3: Verify and Loop

```bash
# Compare screenshots
before=$(md5sum /tmp/gui-screenshot-before.png)
sleep 0.5
scrot /tmp/gui-screenshot-after.png
after=$(md5sum /tmp/gui-screenshot-after.png)

if [ "$before" != "$after" ]; then
  echo "Action took effect"
else
  echo "No change detected — retry or try alternative"
fi
```

---

## Error Handling

| Error | Recovery |
|-------|----------|
| Element not found | Retry with broader search, fall back to vision |
| Action failed (no state change) | Retry same action (max 2x), then alternative |
| Element obscured | Scroll to bring into view, then retry |
| Dialog/modal appeared | Detect modal, click "OK" or dismiss, continue |
| Timeout (max_cycles) | Return partial result with last known state |
| Screenshot capture fails | Retry up to 3x with different tool |

---

## Integration with Hermes Agent

This skill integrates with the Hermes Agent MCP tools:

- **mcp_linear_save_issue**: Create GUI task tracking issues with screenshot evidence.
- **mcp_linear_save_comment**: Annotated screenshot comments for traceability.
- **mcp_linear_get_issue**: Retrieve task context and GUI.md reference.
- **mcp_linear_save_document**: Store GUI.md contracts as Linear documents for sharing.

---

## When to Use This Skill

- Agent needs to interact with desktop applications
- Web automation tasks (form filling, navigation, data extraction)
- Multi-step GUI workflows (e.g., "open settings, change theme, save")
- Tasks where the UI is the primary interface (not API)
- Cross-platform GUI automation where APIs are unavailable

## When Not to Use

- Task has a direct API or CLI equivalent (prefer that)
- Task is read-only and data is available via file/pipe
- Real-time GUI interaction required (< 500ms per action)
- Pixel-precise actions needed (e.g., image editing tools)

---

## References

- [UI-TARS](https://github.com/bytedance/UI-TARS) — Native tokenization for GUI agents
- [PyWinAssistant](https://github.com/Bytedance/PyWinAssistant) — Hybrid Windows automation
- [Aguvis (ICML 2025)](https://aguvis.github.io/) — Pure vision GUI agent
- [GUI.md](https://github.com/gui-dot-md) — Agent-readable GUI contracts
