// xie-agent v0.7 终端交互自动化测试(Bun.Terminal PTY,Windows/Linux 均可跑)
// 运行:bun test
import { test, expect } from "bun:test"
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { stripAnsi } from "../src/color.ts"

const SRC = path.resolve(import.meta.dir, "../src/index.ts")

interface Session {
  term: any
  proc: any
  text: string
  cwd: string
  send(s: string): void
  waitFor(sub: string, ms?: number): Promise<boolean>
  snap(): string
  exitCode(): Promise<number | null>
  close(): Promise<void>
}

async function start(cwd: string, env: Record<string, string> = {}): Promise<Session> {
  let text = ""
  const term = new (Bun as any).Terminal({
    cols: 100,
    rows: 40,
    data(_t: any, d: Uint8Array) {
      text += stripAnsi(new TextDecoder().decode(d))
    },
  })
  const proc = (Bun as any).spawn([process.execPath, SRC], {
    terminal: term,
    cwd,
    env: { ...process.env, XIE_MOCK: "1", ...env },
  })
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  return {
    term,
    proc,
    text,
    cwd,
    send(s: string) {
      term.write(s)
    },
    async waitFor(sub: string, ms = 6000): Promise<boolean> {
      const start = Date.now()
      while (Date.now() - start < ms) {
        if (text.includes(sub)) return true
        await sleep(30)
      }
      return false
    },
    snap() {
      const s = text
      text = ""
      return s
    },
    async exitCode(): Promise<number | null> {
      const code = await Promise.race([
        proc.exited.then(() => proc.exitCode as number),
        sleep(8000).then(() => null),
      ])
      return code
    },
    async close() {
      try {
        term.close?.()
      } catch {
        /* ignore */
      }
      try {
        proc.kill?.()
      } catch {
        /* ignore */
      }
    },
  }
}

function mkNovel(extra: Record<string, string> = {}): string {
  const root = path.join(tmpdir(), `xie-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(path.join(root, "章节"), { recursive: true })
  mkdirSync(path.join(root, "人物"), { recursive: true })
  mkdirSync(path.join(root, "场景"), { recursive: true })
  mkdirSync(path.join(root, "世界观"), { recursive: true })
  writeFileSync(
    path.join(root, "novel.json"),
    JSON.stringify({
      name: "测试",
      model: { provider: "mock" },
      picker: { hiddenCharacters: [], hiddenScenes: [] },
      ...extra,
    }),
  )
  for (const [rel, content] of Object.entries(extra.files ?? {})) {
    writeFileSync(path.join(root, rel), content)
  }
  return root
}

function addChar(root: string, name: string, desc: string) {
  writeFileSync(path.join(root, "人物", `${name}.md`), `# ${name}\n\n- 初始设定:${desc}\n`)
}

function addScene(root: string, name: string, desc: string) {
  writeFileSync(path.join(root, "场景", `${name}.md`), `# ${name}\n\n${desc}\n`)
}

function chapterBody(root: string, file: string): string {
  const text = readFileSync(path.join(root, "章节", file), "utf-8")
  return text.replace(/^---\n[\s\S]*?\n---\n/, "").trim()
}

test("启动冒烟:v0.8 横幅与提示符", async () => {
  const s = await start(mkNovel())
  expect(await s.waitFor("v0.9")).toBe(true)
  expect(await s.waitFor("xie>")).toBe(true)
  await s.close()
})

test("命令候选、Tab 轮转补全与执行", async () => {
  const s = await start(mkNovel())
  await s.waitFor("xie>")
  s.send("/")
  await new Promise((r) => setTimeout(r, 400))
  const afterSlash = s.snap()
  expect(afterSlash).toContain("Tab 补全")
  expect(afterSlash).toContain("/char(人物)")
  expect(afterSlash).toMatch(/\/char\(人物\)[\s\S]*\r?\n[\s\S]*\/check\(检查\)/) // 纵向列表:候选逐行显示
  s.send("\t")
  await new Promise((r) => setTimeout(r, 300))
  expect(s.snap()).toMatch(/\/[a-z]+/)
  s.send("\r")
  expect(await s.waitFor("章节操作")).toBe(true)
  await s.close()
}, 30000)

test("/模型 交互式选择模型与输入密钥", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/模型\r")
  expect(await s.waitFor("选择模型")).toBe(true)
  await new Promise((r) => setTimeout(r, 250))
  const picker = s.snap()
  expect(picker).toContain("deepseek") // 分组标题
  expect(picker).toContain("deepseek-v4-flash")
  s.send("deepseek-v4-flash") // 过滤
  await new Promise((r) => setTimeout(r, 150))
  s.send("\r") // 选中
  expect(await s.waitFor("API Key")).toBe(true)
  s.send("sk-test-12345\r")
  expect(await s.waitFor("高级参数 (temperature/top_p/reasoning_effort)")).toBe(true)
  s.snap()
  s.send("\r") // temperature: off -> input
  expect(await s.waitFor("temperature(0-2")).toBe(true)
  s.send("0.5\r")
  expect(await s.waitFor("top_p: 关闭")).toBe(true)
  s.send("\x1b[B\r") // down -> top_p, select
  expect(await s.waitFor("top_p(0-1")).toBe(true)
  s.send("0.9\r")
  expect(await s.waitFor("top_p: 开启(0.9)")).toBe(true) // top_p 已设置
  s.send("\x1b[B\x1b[B\r") // down x2 -> reasoning_effort, select
  expect(await s.waitFor("reasoning_effort(low/medium/high)")).toBe(true)
  s.send("\x1b[B\x1b[B\x1b[B\r") // down x3 -> high
  expect(await s.waitFor("reasoning_effort: high")).toBe(true) // 主菜单新一帧
  s.send("\x1b[B\x1b[B\x1b[B\x1b[B\r") // down x4 -> done
  expect(await s.waitFor("测试连接")).toBe(true)
  s.send("n\r")
  expect(await s.waitFor("已保存")).toBe(true)
  const cfg = JSON.parse(readFileSync(path.join(root, "novel.json"), "utf-8"))
  expect(cfg.model.provider).toBe("deepseek")
  expect(cfg.model.model).toBe("deepseek-v4-flash")
  expect(cfg.model.apiKey).toBe("sk-test-12345")
  expect(cfg.model.temperature).toBe(0.5)
  expect(cfg.model.topP).toBe(0.9)
  expect(cfg.model.reasoningEffort).toBe("high")
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("/配置 温度/top-p 与还原默认", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/配置 温度 0.7\r")
  expect(await s.waitFor("temperature = 0.7")).toBe(true)
  s.send("/配置 top-p 0.85\r")
  expect(await s.waitFor("top_p = 0.85")).toBe(true)
  s.send("/配置 reasoning-effort high\r")
  expect(await s.waitFor("reasoning_effort = high")).toBe(true)
  let cfg = JSON.parse(readFileSync(path.join(root, "novel.json"), "utf-8"))
  expect(cfg.model.temperature).toBe(0.7)
  expect(cfg.model.topP).toBe(0.85)
  expect(cfg.model.reasoningEffort).toBe("high")
  s.send("/配置 默认\r")
  expect(await s.waitFor("已还原默认")).toBe(true)
  cfg = JSON.parse(readFileSync(path.join(root, "novel.json"), "utf-8"))
  expect(cfg.model.temperature).toBeUndefined()
  expect(cfg.model.topP).toBeUndefined()
  expect(cfg.model.reasoningEffort).toBeUndefined()
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("未配置 key 时写不动并引导 /模型", async () => {
  const root = mkNovel()
  const cfg = JSON.parse(readFileSync(path.join(root, "novel.json"), "utf-8"))
  cfg.model = { provider: "deepseek", model: "deepseek-v4-flash" }
  writeFileSync(path.join(root, "novel.json"), JSON.stringify(cfg))
  writeFileSync(path.join(root, "章节", "001.md"), "---\ntitle: 第一章\n---\n\n")
  const s = await start(root, { XIE_MOCK: "0" })
  await s.waitFor("xie>")
  s.send("随便写点\r")
  expect(await s.waitFor("未配置 API Key")).toBe(true)
  expect(await s.waitFor("现在配置")).toBe(true)
  s.send("n\r")
  expect(await s.waitFor("已跳过")).toBe(true)
  s.snap()
  expect(readFileSync(path.join(root, "章节", "001.md"), "utf-8").includes("随便写点")).toBe(false)
  // 选 y 会进入 /模型 流程
  s.send("再写点\r")
  await s.waitFor("现在配置")
  s.send("y\r")
  expect(await s.waitFor("选择模型")).toBe(true)
  s.send("\x1b") // 取消 /模型
  expect(await s.waitFor("已取消(配置未改动)")).toBe(true)
  s.snap()
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("向导 Esc 返回上一步,q 完全取消", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/写作\r")
  await s.waitFor("要写几章")
  s.send("1\r")
  await s.waitFor("标题")
  s.send("测试章\r")
  await s.waitFor("登场人物")
  s.snap()
  s.send("\x1b") // Esc:人物 → 标题
  expect(await s.waitFor("标题")).toBe(true)
  s.snap()
  s.send("\x1b") // Esc:标题 → 章数
  expect(await s.waitFor("要写几章")).toBe(true)
  s.snap()
  s.send("\x1b") // Esc:章数 → 完全取消
  expect(await s.waitFor("已取消")).toBe(true)
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("文本输入支持光标编辑键", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/写作\r")
  await s.waitFor("要写几章")
  s.send("1\r")
  await s.waitFor("标题")
  s.send("abc")
  s.send("\x1b[D\x1b[D") // ← ←
  s.send("X") // aXbc
  s.send("\x1b[D") // ←
  s.send("\x1b[3~") // Delete → abc
  s.send("\x1b[H") // Home
  s.send("Z") // Zabc
  s.send("\x1b[C") // →
  s.send("Q") // ZaQbc
  s.send("\x1b[F") // End
  s.send("Y") // ZaQbcY
  s.send("\x15") // Ctrl+U 删到行首 → ""
  s.send("内容")
  s.send("\x01") // Ctrl+A 行首
  s.send("\x0b") // Ctrl+K 删到行尾 → ""
  s.send("甲")
  s.send("\x01") // Ctrl+A
  s.send("终") // 终甲
  s.send("\x05") // Ctrl+E 行尾
  s.send("章") // 终甲章
  s.send("\x17") // Ctrl+W 删前一词 → ""
  s.send("终甲节\r") // 标题 = 终甲节
  await s.waitFor("登场人物")
  s.snap()
  s.send("\x1b") // Esc 回到标题步
  expect(await s.waitFor("标题")).toBe(true)
  expect(await s.waitFor("终甲节")).toBe(true) // 预填值证明编辑结果正确
  s.send("q\r")
  await s.waitFor("已取消")
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("候选 ↑↓ 只移动高亮不覆盖输入,Tab 应用", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/")
  await new Promise((r) => setTimeout(r, 350))
  s.send("\x1b[B") // ↓ 移动高亮
  await new Promise((r) => setTimeout(r, 150))
  const snap = s.snap()
  expect(snap).toContain("▶")
  expect(snap).toMatch(/xie> \//) // 输入行仍是 "/",未被候选覆盖
  expect(snap).not.toContain("xie> /世界观")
  s.send("\t") // Tab 应用高亮
  await new Promise((r) => setTimeout(r, 150))
  s.send("\r") // 提交
  expect(await s.waitFor("章节操作")).toBe(true)
  s.send("\x1b") // 收起菜单
  await new Promise((r) => setTimeout(r, 150))
  s.snap()
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("候选列表随高亮滑动,23 个都可到达", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/")
  await new Promise((r) => setTimeout(r, 350))
  s.snap() // 清掉初始候选渲染,只测滚动后的窗口
  for (let i = 0; i < 12; i++) s.send("\x1b[B") // ↓×12:首项滚出可视窗口
  await new Promise((r) => setTimeout(r, 200))
  const mid = s.snap()
  expect(mid).toContain("共 23 个")
  expect(mid).toContain("▶")
  expect(mid).not.toContain("世界观") // 首项已不在窗口内
  for (let i = 0; i < 11; i++) s.send("\x1b[B") // 继续到最后一个
  await new Promise((r) => setTimeout(r, 200))
  const tail = s.snap()
  expect(tail).toContain("▶")
  expect(tail).toContain("共 23 个")
  s.send("\x1b") // 收起候选
  await new Promise((r) => setTimeout(r, 150))
  s.send("\x15") // Ctrl+U 清空输入行
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("向导输入不污染主历史", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/写作\r")
  await s.waitFor("要写几章")
  s.send("1\r")
  await s.waitFor("标题")
  s.send("q\r")
  await s.waitFor("已取消")
  await s.waitFor("xie>")
  s.send("\x1b[A") // ↑ 翻历史
  await new Promise((r) => setTimeout(r, 150))
  const snap = s.snap()
  expect(snap).toContain("/写作")
  expect(snap).not.toMatch(/xie> 1/)
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("/模型 分组与当前标记,密钥打码", async () => {
  const root = mkNovel()
  const cfg = JSON.parse(readFileSync(path.join(root, "novel.json"), "utf-8"))
  cfg.model = { provider: "deepseek", model: "deepseek-v4-flash", apiKey: "sk-super-secret-12345" }
  writeFileSync(path.join(root, "novel.json"), JSON.stringify(cfg))
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/模型\r")
  expect(await s.waitFor("选择模型")).toBe(true)
  await new Promise((r) => setTimeout(r, 250))
  const snap = s.snap()
  expect(snap).toContain("— deepseek —") // 分组标题
  expect(snap).toContain("● deepseek-v4-flash") // 当前标记
  s.send("\x1b") // 取消
  expect(await s.waitFor("已取消(配置未改动)")).toBe(true)
  s.snap()
  s.send("/配置 查看\r")
  expect(await s.waitFor("apiKey")).toBe(true)
  const view = s.snap()
  expect(view).not.toContain("sk-super-secret-12345")
  expect(view).toContain("…") // 打码
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("Ctrl+C:按一次只提示,3 秒内两次退出", async () => {
  const s = await start(mkNovel())
  await s.waitFor("xie>")
  s.send("\x03")
  expect(await s.waitFor("再按一次 Ctrl+C")).toBe(true)
  s.send("\x03")
  expect(await s.exitCode()).toBe(0)
  await s.close()
})

test("Ctrl+C:超过 3 秒不算连按,不退出", async () => {
  const s = await start(mkNovel())
  await s.waitFor("xie>")
  s.send("\x03")
  expect(await s.waitFor("再按一次 Ctrl+C")).toBe(true)
  await new Promise((r) => setTimeout(r, 3300))
  s.send("\x03")
  expect(await s.waitFor("再按一次 Ctrl+C", 1500)).toBe(true)
  s.send("\x03")
  expect(await s.exitCode()).toBe(0)
  await s.close()
})

test("写作中显示 spinner,Esc 双击打断且不保存", async () => {
  const root = mkNovel()
  writeFileSync(path.join(root, "章节", "001.md"), "---\ntitle: 第一章\nchars: []\n---\n\n")
  const s = await start(root, { XIE_MOCK_DELAY: "8000" })
  await s.waitFor("xie>")
  s.send("/写作 --n 1 测试\r")
  expect(await s.waitFor("生成中")).toBe(true)
  expect(s.snap()).toContain("生成中")
  s.send("\x1b")
  expect(await s.waitFor("再按 Esc 打断")).toBe(true)
  s.send("\x1b")
  expect(await s.waitFor("已打断")).toBe(true)
  expect(chapterBody(root, "001.md")).toBe("")
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("向导:人物选择器(空格选中)与场景选择器(回车单选)", async () => {
  const root = mkNovel()
  addChar(root, "林晚", "黑发剑客,外冷内热")
  addChar(root, "沈无涯", "白衣书生")
  addScene(root, "宗门大殿", "九根盘龙柱")
  addScene(root, "青州城门", "城墙斑驳")
  const s = await start(root, { XIE_MOCK_DELAY: "30" })
  await s.waitFor("xie>")
  s.send("/写作\r")
  expect(await s.waitFor("要写几章")).toBe(true)
  s.send("1\r")
  expect(await s.waitFor("标题")).toBe(true)
  s.send("测试章\r")
  expect(await s.waitFor("登场人物")).toBe(true)
  await new Promise((r) => setTimeout(r, 250))
  const picker = s.snap()
  expect(picker).toContain("林晚")
  expect(picker).toContain("沈无涯")
  s.send(" ") // 空格选中林晚
  await new Promise((r) => setTimeout(r, 150))
  s.send("\r") // 回车确定
  expect(await s.waitFor("场景")).toBe(true)
  await new Promise((r) => setTimeout(r, 250))
  expect(s.snap()).toContain("宗门大殿")
  s.send("\r")
  expect(await s.waitFor("剧情大纲")).toBe(true)
  s.send("\r")
  expect(await s.waitFor("开始写作")).toBe(true)
  s.send("y\r")
  expect(await s.waitFor("写作结束", 15000)).toBe(true)
  const meta = readFileSync(path.join(root, "章节", "001.md"), "utf-8").split("\n")
  expect(meta[1]).toContain("测试章")
  expect(meta[3]).toContain("宗门大殿")
  expect(meta[4]).toContain("林晚")
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("选择器内 h 隐藏(可搜索)与 d 双击删除", async () => {
  const root = mkNovel()
  addChar(root, "林晚", "黑发剑客")
  addChar(root, "沈无涯", "白衣书生")
  const s = await start(root, { XIE_MOCK_DELAY: "30" })
  await s.waitFor("xie>")
  s.send("/写作\r")
  await s.waitFor("要写几章")
  s.send("1\r")
  await s.waitFor("标题")
  s.send("测试章\r")
  await s.waitFor("登场人物")
  await new Promise((r) => setTimeout(r, 250))
  s.snap() // 丢弃旧帧,只检查隐藏后的列表
  // h 隐藏林晚
  s.send("h")
  expect(await s.waitFor("已隐藏「林晚」")).toBe(true)
  await new Promise((r) => setTimeout(r, 250))
  expect(s.snap()).not.toContain("林晚 —")
  const cfg = JSON.parse(readFileSync(path.join(root, "novel.json"), "utf-8"))
  expect(cfg.picker.hiddenCharacters).toContain("林晚")
  // 输入名字仍可选中
  s.send("林")
  await new Promise((r) => setTimeout(r, 250))
  expect(s.snap()).toContain("林晚 —")
  s.send(" ")
  await new Promise((r) => setTimeout(r, 150))
  s.send("\r")
  await s.waitFor("场景")
  s.send("\x1b") // 取消场景选择,退出向导
  await s.waitFor("xie>")
  s.send("/退出\r")
  await s.exitCode()
  await s.close()

  // d 双击删除沈无涯
  const s2 = await start(root, { XIE_MOCK_DELAY: "30" })
  await s2.waitFor("xie>")
  s2.send("/写作\r")
  await s2.waitFor("要写几章")
  s2.send("1\r")
  await s2.waitFor("标题")
  s2.send("测试章\r")
  await s2.waitFor("登场人物")
  await new Promise((r) => setTimeout(r, 250))
  s2.send("d")
  expect(await s2.waitFor("再按 d 确认删除")).toBe(true)
  s2.send("d")
  expect(await s2.waitFor("已删除「沈无涯」")).toBe(true)
  expect(existsSync(path.join(root, "人物", "沈无涯.md"))).toBe(false)
  s2.send("\x1b")
  await s2.waitFor("xie>")
  s2.send("/退出\r")
  await s2.exitCode()
  await s2.close()
}, 30000)

test("向导:新建场景默认隐藏,不进入候选列表", async () => {
  const root = mkNovel()
  const s = await start(root, { XIE_MOCK_DELAY: "30" })
  await s.waitFor("xie>")
  s.send("/写作\r")
  await s.waitFor("要写几章")
  s.send("1\r")
  await s.waitFor("标题")
  s.send("测试章\r")
  await s.waitFor("登场人物")
  await new Promise((r) => setTimeout(r, 200))
  s.send("\r") // (无)人物
  await s.waitFor("场景")
  await new Promise((r) => setTimeout(r, 200))
  s.send("\x1b[B")
  s.send("\x1b[B")
  await new Promise((r) => setTimeout(r, 150))
  s.send("\r") // 进入新建场景
  expect(await s.waitFor("新场景名字")).toBe(true)
  s.send("测试场景\r")
  expect(await s.waitFor("场景描述")).toBe(true)
  s.send("深山古刹\r")
  expect(await s.waitFor("默认隐藏")).toBe(true)
  await new Promise((r) => setTimeout(r, 200))
  s.send("\r") // 选「隐藏(默认)」
  expect(await s.waitFor("剧情大纲")).toBe(true)
  s.send("\r")
  expect(await s.waitFor("开始写作")).toBe(true)
  s.send("y\r")
  expect(await s.waitFor("写作结束", 15000)).toBe(true)
  expect(existsSync(path.join(root, "场景", "测试场景.md"))).toBe(true)
  const cfg = JSON.parse(readFileSync(path.join(root, "novel.json"), "utf-8"))
  expect(cfg.picker.hiddenScenes).toContain("测试场景")
  const meta = readFileSync(path.join(root, "章节", "001.md"), "utf-8").split("\n")
  expect(meta[3]).toContain("测试场景")
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("/人物 隐藏/显示/删除 与 /场景 删除、/世界观 删除", async () => {
  const root = mkNovel()
  addChar(root, "林晚", "黑发剑客")
  addScene(root, "宗门大殿", "九根盘龙柱")
  writeFileSync(path.join(root, "世界观", "修真境界.md"), "# 修真境界\n\n炼气→筑基\n")
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/人物 隐藏 林晚\r")
  expect(await s.waitFor("已隐藏「林晚」")).toBe(true)
  s.snap()
  s.send("/人物 显示 林晚\r")
  expect(await s.waitFor("已恢复「林晚」")).toBe(true)
  s.snap()
  s.send("/人物 删除 林晚\r")
  await s.waitFor("确认删除人物")
  s.snap()
  s.send("n\r")
  await s.waitFor("已取消")
  expect(existsSync(path.join(root, "人物", "林晚.md"))).toBe(true)
  s.snap()
  s.send("/人物 删除 林晚\r")
  await s.waitFor("确认删除人物")
  s.snap()
  s.send("y\r")
  expect(await s.waitFor("已删除人物「林晚」")).toBe(true)
  expect(existsSync(path.join(root, "人物", "林晚.md"))).toBe(false)
  s.snap()
  s.send("/场景 删除 宗门大殿\r")
  await s.waitFor("确认删除场景")
  s.snap()
  s.send("y\r")
  expect(await s.waitFor("已删除场景「宗门大殿」")).toBe(true)
  s.snap()
  s.send("/世界观 删除 修真境界\r")
  await s.waitFor("确认删除世界观条目")
  s.snap()
  s.send("y\r")
  expect(await s.waitFor("已删除条目「修真境界」")).toBe(true)
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("旧版英文目录自动迁移为中文", async () => {
  const root = path.join(tmpdir(), `xie-migrate-${Date.now()}`)
  mkdirSync(path.join(root, "chapters"), { recursive: true })
  mkdirSync(path.join(root, "characters"), { recursive: true })
  mkdirSync(path.join(root, ".agent"), { recursive: true })
  writeFileSync(path.join(root, "novel.json"), JSON.stringify({ name: "老作品", model: { provider: "mock" } }))
  writeFileSync(path.join(root, "chapters", "001.md"), "---\ntitle: 第一章\n---\n\n正文")
  writeFileSync(path.join(root, "characters", "林晚.md"), "# 林晚\n")
  writeFileSync(path.join(root, "style.md"), "# 风格")
  writeFileSync(path.join(root, ".agent", "session.json"), "{}")
  const s = await start(root)
  await s.waitFor("xie>")
  expect(existsSync(path.join(root, "章节"))).toBe(true)
  expect(existsSync(path.join(root, "人物"))).toBe(true)
  expect(existsSync(path.join(root, "风格.md"))).toBe(true)
  expect(existsSync(path.join(root, ".会话"))).toBe(true)
  expect(existsSync(path.join(root, "chapters"))).toBe(false)
  expect(existsSync(path.join(root, "characters"))).toBe(false)
  expect(existsSync(path.join(root, "章节", "001.md"))).toBe(true)
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
})

test("非 TTY 管道输入:文本回退向导可完成", async () => {
  const root = mkNovel()
  addChar(root, "林晚", "黑发剑客")
  addScene(root, "宗门大殿", "九根盘龙柱")
  const input = "/写作\n1\n管道章\n1\n1\n\ny\n/退出\n"
  const proc = (Bun as any).spawn([process.execPath, SRC], {
    cwd: root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, XIE_MOCK: "1", XIE_MOCK_DELAY: "30" },
  })
  proc.stdin.write(new TextEncoder().encode(input))
  proc.stdin.end?.()
  const out = await (Bun as any).readableStreamToText(proc.stdout)
  const code = await proc.exited.then(() => proc.exitCode)
  expect(out).toContain("写作结束")
  expect(code).toBe(0)
  expect(existsSync(path.join(root, "章节", "001.md"))).toBe(true)
}, 30000)

test("双语补全:/mo 显示 /model(模型),Tab 插入英文", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/mo")
  await new Promise((r) => setTimeout(r, 300))
  expect(s.snap()).toContain("/model(模型)")
  s.send("\t")
  await new Promise((r) => setTimeout(r, 200))
  expect(s.snap()).toContain("xie> /model")
  s.send("\r")
  expect(await s.waitFor("选择模型")).toBe(true)
  s.send("\x1b")
  await new Promise((r) => setTimeout(r, 150))
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("AI 意图:帮我新建一个角色 → 确认/补齐/创建", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("帮我新建一个角色\r")
  expect(await s.waitFor("识别为:新建角色")).toBe(true)
  s.send("\r")
  expect(await s.waitFor("角色名字")).toBe(true)
  s.send("测试角色\r")
  expect(await s.waitFor("一句话设定")).toBe(true)
  s.send("黑发剑客\r")
  expect(await s.waitFor("已创建人物「测试角色」")).toBe(true)
  expect(await s.waitFor("是否出现在候选中")).toBe(true)
  s.send("\r")
  await new Promise((r) => setTimeout(r, 200))
  expect(existsSync(path.join(root, "人物", "测试角色.md"))).toBe(true)
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("AI 意图:把林晚改成冷艳型 → 修改流程(无 key 直接重写)", async () => {
  const root = mkNovel()
  addChar(root, "林晚", "黑发剑客")
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("把林晚改成冷艳型\r")
  expect(await s.waitFor("识别为:修改角色")).toBe(true)
  s.send("\r")
  expect(await s.waitFor("新的完整内容")).toBe(true)
  s.send("冷艳型,黑发剑客,话少\r")
  expect(await s.waitFor("已更新人物「林晚」")).toBe(true)
  const text = readFileSync(path.join(root, "人物", "林晚.md"), "utf-8")
  expect(text).toContain("冷艳型")
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("AI 意图:普通写作句不弹确认,直接写作", async () => {
  const root = mkNovel()
  writeFileSync(path.join(root, "章节", "001.md"), "---\ntitle: 第一章\n---\n\n")
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("让主角在城门口遇到敌人\r")
  expect(await s.waitFor("已保存到", 15000)).toBe(true)
  expect(chapterBody(root, "001.md").length).toBeGreaterThan(0)
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("AI 意图:生成角色/大纲走生成流程而非写作(无 key 回退规则)", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("生成角色 冷面剑客\r")
  expect(await s.waitFor("识别为:生成角色")).toBe(true)
  s.send("\r")
  expect(await s.waitFor("满意吗")).toBe(true)
  s.send("y\r")
  expect(await s.waitFor("已保存人物档案")).toBe(true)
  await new Promise((r) => setTimeout(r, 150))
  expect(readdirSync(path.join(root, "人物")).length).toBeGreaterThan(0)
  s.send("生成大纲\r")
  expect(await s.waitFor("识别为:生成大纲")).toBe(true)
  s.send("\r")
  expect(await s.waitFor("大纲内容")).toBe(true)
  s.send("主线:林晚寻兄复仇\r")
  expect(await s.waitFor("已追加到大纲")).toBe(true)
  expect(existsSync(path.join(root, "大纲", "总纲.md"))).toBe(true)
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("人物无参数 = 操作菜单,列表仍可用", async () => {
  const root = mkNovel()
  addChar(root, "云禾", "冷面剑客")
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/人物\r")
  expect(await s.waitFor("角色操作")).toBe(true)
  await new Promise((r) => setTimeout(r, 200))
  const snap = s.snap()
  expect(snap).toContain("添加角色")
  expect(snap).toContain("修改角色")
  expect(snap).toContain("删除角色")
  s.send("\x1b") // 返回
  await new Promise((r) => setTimeout(r, 150))
  s.snap()
  s.send("/人物 列表\r")
  expect(await s.waitFor("人物列表")).toBe(true)
  expect(await s.waitFor("云禾")).toBe(true)
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("人物操作菜单:选择 添加角色 走交互创建", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/人物\r")
  expect(await s.waitFor("角色操作")).toBe(true)
  s.send("\r") // 第一项 = 添加角色
  expect(await s.waitFor("角色名字")).toBe(true)
  s.send("菜单角色\r")
  expect(await s.waitFor("一句话设定")).toBe(true)
  s.send("测试设定\r")
  expect(await s.waitFor("已创建人物「菜单角色」")).toBe(true)
  expect(await s.waitFor("是否出现在候选中")).toBe(true)
  s.send("\r")
  await new Promise((r) => setTimeout(r, 150))
  expect(existsSync(path.join(root, "人物", "菜单角色.md"))).toBe(true)
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("章节无参数 = 操作菜单,新建章节交互创建", async () => {
  const root = mkNovel()
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/章节\r")
  expect(await s.waitFor("章节操作")).toBe(true)
  s.send("\r") // 第一项 = 新建章节
  expect(await s.waitFor("章节标题")).toBe(true)
  s.send("第一章测试\r")
  expect(await s.waitFor("已创建 001.md")).toBe(true)
  expect(existsSync(path.join(root, "章节", "001.md"))).toBe(true)
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)

test("修改意见支持粘贴多行,流程不受影响", async () => {
  const root = mkNovel()
  addChar(root, "云禾", "山村姑娘")
  const s = await start(root)
  await s.waitFor("xie>")
  s.send("/人物\r")
  expect(await s.waitFor("角色操作")).toBe(true)
  s.send("\x1b[B\x1b[B\r") // ↓↓ 到 修改角色
  expect(await s.waitFor("选择角色")).toBe(true)
  s.send("\r") // 选中 云禾
  expect(await s.waitFor("修改意见")).toBe(true)
  s.send("云禾是山村小姑娘\r\n短发晒得黑\r\n家里种田养牛") // 粘贴多行
  await new Promise((r) => setTimeout(r, 200))
  s.snap()
  s.send("\r") // 提交
  expect(await s.waitFor("新的完整内容")).toBe(true)
  s.send("山村小姑娘,短发,种田养牛\r")
  expect(await s.waitFor("已更新人物「云禾」")).toBe(true)
  const text = readFileSync(path.join(root, "人物", "云禾.md"), "utf-8")
  expect(text).toContain("种田养牛")
  s.send("/退出\r")
  await s.exitCode()
  await s.close()
}, 30000)
