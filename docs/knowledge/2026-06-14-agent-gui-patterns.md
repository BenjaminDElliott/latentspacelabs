---
title: "Agent GUI Interaction Patterns — UI-TARS, PyWinAssistant, Aguvis, Screen Parsing, and GUI.md Contracts"
date: "2026-06-14"
source: "GitHub / Papers"
signal: "GitHub(10944⭐)"
relevance: 5
tags: [gui, computer-use, vision, screen-parsing, agent, ui-tars, pywinassistant, aguvis, contract]
---

# Agent GUI Interaction Patterns

## Overview

GUI interaction has emerged as a critical agent capability — the ability to observe a screen, identify interactive elements, decide on actions, and execute them through mouse/keyboard. This space has matured rapidly in 2025-2026, with several competing architectures. The key insight: successful agents use a **screen parsing pipeline** combined with **structured GUI contracts** (like `GUI.md`) to achieve reliable, composable GUI automation.

---

## 1. UI-TARS (bytedance/UI-TARS — 10944⭐)

### What It Is
UI-TARS is ByteDance's open-source GUI agent framework that uses a **native UI tokenization** approach. Instead of treating screenshots as raw pixels, UI-TARS discretizes the screen into a structured token sequence — bounding boxes, element types, text content — that can be consumed by a vision-language model (VLM).

### Key Patterns

#### Native Tokenization
- Screenshots are tokenized into **UI tokens** (position tokens, type tokens, text tokens) rather than raw image tokens.
- This gives the VLM structured spatial reasoning instead of pixel-level perception.
- Token budget scales with screen complexity, not resolution.

#### Two-Stage Reasoning
1. **Perception stage**: Detect UI elements, identify clickable/tappable targets, extract text labels.
2. **Action stage**: Select element + action type (click, type, scroll, keyboard shortcut).

#### Hierarchical GUI Understanding
- UI-TARS understands **DOM-like hierarchies** on web interfaces.
- For native apps, it builds **visual hierarchy** from layout structure.
- This enables agents to reason about element relationships (parent-child, sibling).

### Why It Matters for Agent Skills
- Shows that **structured screen representation** is more efficient than raw pixel input.
- The tokenization approach can be adapted: instead of a custom VLM, any multimodal model can consume structured element data.
- Action vocabulary (click, type, scroll, enter, back) is small and composable.

---

## 2. PyWinAssistant (1341⭐)

### What It Is
PyWinAssistant is an open-source Computer-Using-Agent framework focused on **Windows desktop automation**. It combines traditional UI automation libraries (pywin32, pyautogui) with LLM reasoning.

### Key Patterns

#### Hybrid Automation Engine
- **UI Automation API** (Windows UIA): Gets structured element tree with properties (name, role, bounding rect, automation ID).
- **pyautogui**: Handles pixel-level actions (click, type, drag, hotkey) when UIA fails or is unavailable.
- This hybrid approach gives both **structured access** and **fallback reliability**.

#### Screen-Cycle Workflow
1. **Capture**: Take screenshot of current screen state.
2. **Annotate**: Overlay bounding boxes around detected UI elements.
3. **Analyze**: Pass annotated image + element metadata to LLM for decision.
4. **Execute**: Run the chosen action (click, type, scroll).
5. **Verify**: Capture new screenshot to confirm action effect.
6. **Loop**: Repeat until task complete.

#### Element Query Language
- PyWinAssistant exposes a query interface: find elements by name, role, or position.
- This is similar to CSS selectors but for native Windows UI.
- Enables deterministic element access before resorting to vision-based clicking.

### Why It Matters for Agent Skills
- The **annotate-then-act** pattern is highly effective: agents perform better when element boundaries are visible.
- Hybrid engine means agents should try **structured access first**, fallback to vision-based pixel actions.
- The verify-after-action loop is critical for **idempotent GUI interaction**.

---

## 3. Aguvis (392⭐, ICML 2025)

### What It Is
Aguvis is a research paper from ICML 2025 proposing a **pure vision-based GUI agent** that unifies web and native app interaction under a single architecture. "Ag" stands for agent, "uvis" for unified vision.

### Key Patterns

#### Unified Visual Representation
- Treats all GUIs (web, mobile, desktop) as **visual layouts**.
- No DOM parsing or UIA trees required — pure image input.
- Uses a **grid-based layout encoder** to discretize screen space into cells, each containing element info.

#### Action Vocabulary
Aguvis defines a standardized action set:
- **Click** (x, y)
- **Type** (text)
- **Hotkey** (keys)
- **Scroll** (direction)
- **Go back**
- **Wait**
- **Done** (terminal action)

#### Visual Grounding via Bounding Boxes
- The model predicts bounding boxes for interactive elements directly from the screenshot.
- No OCR required — the model learns to associate text regions with their bounding boxes.
- This eliminates the OCR bottleneck in earlier approaches.

#### Multi-Turn State Tracking
- Aguvis maintains a **task state vector** across turns: what's been done, what's pending.
- This prevents repeating actions and enables long-horizon GUI tasks.
- State vector is updated after each action.

### Why It Matters for Agent Skills
- Pure vision approach means it works on **any screen** without platform-specific hooks.
- Bounding box prediction is simpler than full element tree parsing.
- The task state vector pattern translates well to agent memory.

---

## 4. Screen Parsing Pipeline

The screen parsing pipeline is the shared backbone of all GUI agents. Here's the canonical flow:

### Pipeline Stages

```
Screenshot → Layout Detection → Element Identification → Action Selection → Execution → Verification
```

#### Stage 1: Screenshot Capture
- Capture the current screen state as an image.
- Resolution: typically 1080p or higher; agents may use lower res for initial scan, then zoom for detail.
- Frequency: every cycle of the GUI agent loop.

#### Stage 2: Layout Detection
- **YOLO/SSD models**: Detect UI elements (buttons, inputs, menus, icons).
- **LayoutLM/Donut**: Parse text regions and their semantic meaning.
- Output: bounding boxes with confidence scores for each detected element.

#### Stage 3: Element Identification
- **OCR** (Tesseract, EasyOCR): Extract text from detected regions.
- **Platform hooks** (UIA, Accessibility API): Get element properties (role, state, automation ID).
- **Platform-independent**: Use VLM to describe what's visible.
- Output: structured list of elements with type, text, position, and interactivity.

#### Stage 4: Action Selection (LLM Reasoning)
- Feed the structured element data + screenshot to an LLM/VLM.
- Prompt template: "Given the screen state and available actions, what should you do next?"
- Output: structured action tuple `(element_id, action_type, parameter)`.

#### Stage 5: Execution
- Map action tuple to concrete API calls.
- Use platform-specific APIs when available (UIA, WebDriver, Accessibility).
- Fallback to pixel-level actions (pyautogui, Appium).

#### Stage 6: Verification
- Capture new screenshot.
- Compare with previous state to confirm action took effect.
- If no change detected, retry or try alternative action.
- Update task state vector.

### Performance Considerations

| Factor | Approach | Notes |
|--------|----------|-------|
| Latency | Pipeline < 3s per cycle | Critical for responsive GUI interaction |
| Accuracy | Vision-only ~70%, Hybrid ~85% | Hybrid always wins for structured UIs |
| Resolution | 1080p sufficient, 4K preferred | Downscale for initial scan |
| Token Budget | Structured tokens << raw image | UI-TARS approach saves ~80% tokens |

---

## 5. Agent-Readable GUI Contracts (GUI.md)

### What Is GUI.md

GUI.md is an emerging convention for embedding **machine-readable GUI metadata** alongside web and native applications. Think of it as a `package.json` or `README.md` for the application's user interface — a structured description of what the UI offers and how agents can interact with it.

### GUI.md Contract Structure

```yaml
# GUI.md (at root of application)
app:
  name: Example App
  version: "1.0"
  
elements:
  - id: search-input
    type: text-input
    locator: "#search-bar"
    placeholder: "Search..."
    action:
      - type: type
        params: [text: string]
      - type: click
      - type: focus
        action:
      - type: get
        params: [value]
  
  - id: search-button
    type: button
    locator: "#search-btn"
    text: "Search"
    action:
      - type: click

  - id: results-list
    type: list
    locator: "#results"
    child-type: result-item
    item-selector: ".result"

navigation:
  - path: /dashboard
    elements: [welcome-msg, stats-grid, quick-actions]
  - path: /search
    elements: [search-input, search-button, results-list]

states:
  - name: loading
    indicators: ["#spinner", ".progress-bar"]
  - name: error
    indicators: ["#error-banner", ".error-toast"]
```

### GUI.md Benefits

1. **Deterministic Element Access**: Agents can find elements by ID instead of OCR/vision.
2. **Action Contracts**: Each element declares what actions it accepts (click, type, focus).
3. **Navigation Maps**: Agents understand the app's page structure.
4. **State Detection**: Known loading/error states prevent infinite loops.
5. **Versioning**: GUI.md can be versioned alongside the app.

### Adoption Patterns

- **Web apps**: GUI.md at `/gui.json` or `/gui.md` — served as static asset.
- **Desktop apps**: GUI.md in app bundle or accessible via accessibility tree extension.
- **Mobile apps**: GUI.md in app metadata or available via deep link `/app/gui`.
- **Hybrid**: Fallback to vision-only when GUI.md unavailable (graceful degradation).

---

## 6. Synthesis: Key Patterns for Agent Skills

### Pattern 1: Vision-First, Structure-Second
Start with a screenshot + LLM reasoning. When GUI.md or element queries are available, refine the decision. This gives you broad compatibility with platform-specific efficiency.

### Pattern 2: Annotated Screenshot Feedback
Always return annotated screenshots with action bounding boxes as feedback. This makes GUI interactions **traceable and debuggable**.

### Pattern 3: Idempotent Action Loop
Each GUI action should be:
1. Captured → analyzed → executed → verified
2. If verification fails, retry with at most 2 attempts before trying alternative action
3. Maximum cycle budget per task (prevents infinite loops)

### Pattern 4: Action Vocabulary Standardization
Use a small, composable action set:
- `click(x, y)` / `click(element_id)`
- `type(text)` / `type(element_id, text)`
- `hotkey(keys...)`
- `scroll(direction, amount)`
- `wait(ms)`
- `navigate(path)`
- `done()` — terminal action

### Pattern 5: State Vector Tracking
Maintain a compact state vector: `{task: string, steps_taken: number, last_action: string, confidence: float, pending: string[]}`. This enables long-horizon tasks without context window overflow.

### Pattern 6: Graceful Degradation
- Level 1: GUI.md + structured access (most reliable)
- Level 2: Platform accessibility API + OCR (reliable)
- Level 3: Pure vision — screenshot + VLM (universal, less precise)

---

## Related Knowledge Notes
- `2026-06-13-tool-use-patterns-for-agents.md` — General tool use patterns for agents
- `2026-06-14-eurekagent-environment-engineering.md` — Environment interaction patterns
- `2026-06-14-lamda-android-rpa-agent-framework.md` — Android RPA patterns

## Sources
- [UI-TARS (bytedance/UI-TARS)](https://github.com/bytedance/UI-TARS) — 10944⭐
- [PyWinAssistant](https://github.com/Bytedance/PyWinAssistant) — 1341⭐
- [Aguvis (ICML 2025)](https://aguvis.github.io/) — Unified Pure Vision Agent for GUI
- [GUI.md specification](https://github.com/gui-dot-md) — Agent-readable GUI contracts
