# pi-xie

pi-xie is a self-maintained writing-focused terminal agent forked from Pi. It keeps Pi's TUI, agent loop, session management, and extension system, while replacing the coding-first system prompt and tooling with a novel-writing workflow.

## Quick start

```powershell
npm install -g --ignore-scripts pi-xie
cd path\to\novel
pi-xie
```

Or run the Windows binary:

```powershell
pi-xie.exe
```

Configure an API key first, for example:

```powershell
$env:OPENAI_API_KEY="sk-..."
```

## Writing model

- Story = character + scene + event.
- Characters and scenes are primary premises and can be freely combined.
- Worldview, outline, timeline, and style are secondary constraints.
- Chapters are stored as Markdown files under `chapters/`.
- `manuscript.txt` is automatically maintained as the combined full manuscript.

## Workspace layout

```text
novel/
  premises/
    characters/
    scenes/
    worldview.md
    outline.md
    timeline.md
    style.md
    active.json
  chapters/
    001.md
  manuscript.txt
```

## Writing commands

- `/character`, `/scene` - manage characters and scenes
- `/worldview`, `/outline`, `/timeline`, `/style` - edit constraints
- `/premise` - select the active character/scene combination
- `/write` - ask the agent to write a chapter
- `/manuscript` - rebuild `manuscript.txt` from chapter files
- `/undo` - revert the last writing-tool change

## Development

```powershell
npm install --ignore-scripts
npm run build
npm run test
```
