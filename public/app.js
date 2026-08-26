(() => {
  const thread = document.getElementById("thread");
  const form = document.getElementById("form");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const newChatBtn = document.getElementById("newChat");
  const statusPill = document.getElementById("statusPill");
  const overlay = document.getElementById("loadingOverlay");
  const loadingText = document.getElementById("loadingText");
  const modeTag = document.getElementById("modeTag");
  const hint = document.getElementById("hint");
  const modeSearch = document.getElementById("modeSearch");
  const modeAsk = document.getElementById("modeAsk");

  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  let chatId = uuid();
  let busy = false;
  let mode = "search"; // search | ask
  let askWarm = false;

  const PHASE_TH = {
    starting: "กำลังเริ่มต้น…",
    slots: "กำลังแยก intent…",
    sql: "กำลังค้น SQL…",
    "sql:hq": "กำลังค้น HQ…",
    "sql:syp": "กำลังค้น SYP…",
    format: "กำลังจัดตาราง…",
    warmup: "กำลังอุ่น Agent…",
    agent: "Agent กำลังตอบ…",
    tools: "Agent ใช้เครื่องมือ…",
    generating: "กำลังสร้างคำตอบ…",
    done: "เสร็จแล้ว",
    error: "เกิดข้อผิดพลาด",
    timeout: "หมดเวลา",
  };

  function showEmpty() {
    if (mode === "ask") {
      thread.innerHTML = `
        <div class="empty">
          <strong>โหมดถาม (Agent)</strong><br />
          อุ่นเครื่องตอนเข้าโหมดนี้ — คุยต่อในเซสชันเดิมได้ (ช้ากว่าค้นหา แต่ยืดหยุ่นกว่า)
        </div>`;
    } else {
      thread.innerHTML = `
        <div class="empty">
          <strong>โหมดค้นหาสินค้า</strong><br />
          ฟรีเท็กซ์ → intent slots → SQL PARTS9 (เช่น ฝาวาล์ว 18 ลิตร PTT)
        </div>`;
    }
  }

  function applyModeChrome() {
    modeSearch.classList.toggle("active", mode === "search");
    modeAsk.classList.toggle("active", mode === "ask");
    statusPill.textContent = mode === "ask" ? (askWarm ? "Agent พร้อม" : "Agent") : "ค้นหาสินค้า";
    modeTag.textContent =
      mode === "ask"
        ? "ถาม · Agent (warm session)"
        : "ค้นหา · intent slots → SQL";
    hint.textContent =
      mode === "ask"
        ? "Ask: Agent อุ่นตอนเข้าโหมด · ข้อความถัดไปใช้ session เดิม"
        : "Search: slots (local/OpenAI) → SQL · ตารางจากโค้ด (เร็ว)";
    input.placeholder =
      mode === "ask"
        ? "ถามอะไรก็ได้เกี่ยวกับ PARTS9 / เอกสาร…"
        : "ชื่อสินค้า / ขนาด / แบรนด์ หรือ BCODE";
    showEmpty();
  }

  async function warmupAsk() {
    statusPill.innerHTML = `<span class="spinner spinner-sm" aria-hidden="true"></span> อุ่น Agent…`;
    modeAsk.disabled = true;
    try {
      const res = await fetch("/api/ask/warmup", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "warmup failed");
      askWarm = true;
      statusPill.textContent = `Agent พร้อม · ${data.warm_ms} ms`;
    } catch (err) {
      askWarm = false;
      statusPill.textContent = "อุ่นไม่สำเร็จ";
      addMessage("assistant", `อุ่น Agent ไม่สำเร็จ: ${err.message}`);
    } finally {
      modeAsk.disabled = false;
    }
  }

  async function setMode(next) {
    if (busy || next === mode) return;
    mode = next;
    chatId = uuid();
    applyModeChrome();
    if (mode === "ask" && !askWarm) await warmupAsk();
  }

  modeSearch.addEventListener("click", () => setMode("search"));
  modeAsk.addEventListener("click", () => setMode("ask"));

  showEmpty();
  applyModeChrome();

  function setBusy(v, phase) {
    busy = v;
    sendBtn.disabled = v;
    modeSearch.disabled = v;
    modeAsk.disabled = v;
    const idleLabel = mode === "ask" ? (askWarm ? "Agent พร้อม" : "Agent") : "ค้นหาสินค้า";
    statusPill.innerHTML = v
      ? `<span class="spinner spinner-sm" aria-hidden="true"></span> ${PHASE_TH[phase] || "กำลังทำงาน…"}`
      : idleLabel;
    statusPill.classList.toggle("busy", v);
    if (overlay) {
      overlay.hidden = !v;
      if (loadingText) loadingText.textContent = PHASE_TH[phase] || "กำลังประมวลผล…";
    }
    sendBtn.innerHTML = v
      ? `<span class="spinner spinner-sm light" aria-hidden="true"></span> รอ`
      : "ส่ง";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMarkdown(src) {
    let text = String(src || "").replace(/\r\n/g, "\n");
    const blocks = [];
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const i = blocks.length;
      blocks.push(
        `<pre><code class="language-${escapeHtml(lang)}">${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`
      );
      return `\u0000BLOCK${i}\u0000`;
    });
    const lines = text.split("\n");
    const out = [];
    let listType = null;
    const closeList = () => {
      if (listType) {
        out.push(listType === "ol" ? "</ol>" : "</ul>");
        listType = null;
      }
    };
    const inline = (s) => {
      let t = escapeHtml(s);
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      return t;
    };
    for (const line of lines) {
      const fence = line.match(/^\u0000BLOCK(\d+)\u0000$/);
      if (fence) {
        closeList();
        out.push(blocks[Number(fence[1])]);
        continue;
      }
      if (/^\|/.test(line) && /\|/.test(line.slice(1))) {
        // keep tables as pre-formatted block groups — simple: escape as paragraph with monospace via pre if separator
      }
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        closeList();
        out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
        continue;
      }
      const ul = line.match(/^[-*]\s+(.*)$/);
      if (ul) {
        if (listType !== "ul") {
          closeList();
          out.push("<ul>");
          listType = "ul";
        }
        out.push(`<li>${inline(ul[1])}</li>`);
        continue;
      }
      if (!line.trim()) {
        closeList();
        continue;
      }
      closeList();
      if (line.trim().startsWith("|")) {
        out.push(`<pre class="table-line">${escapeHtml(line)}</pre>`);
      } else {
        out.push(`<p>${inline(line)}</p>`);
      }
    }
    closeList();
    return out.join("\n");
  }

  function addMessage(role, text) {
    if (thread.querySelector(".empty")) thread.innerHTML = "";
    const el = document.createElement("article");
    el.className = `msg ${role}`;
    el.innerHTML = `
      <div class="role">${role === "user" ? "คุณ" : mode === "ask" ? "Agent" : "KCW Search"}</div>
      <div class="bubble"></div>
      <div class="meta-row"></div>
    `;
    const bubble = el.querySelector(".bubble");
    if (role === "user") bubble.textContent = text;
    else bubble.innerHTML = renderMarkdown(text || "");
    thread.appendChild(el);
    thread.scrollTop = thread.scrollHeight;
    return el;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function formatTiming(t, modeName, slotSource) {
    if (!t) return "";
    if (modeName === "ask") {
      return [
        t.warm_ms ? `อุ่น ${t.warm_ms} ms` : null,
        t.agent_ms != null ? `Agent ${t.agent_ms} ms` : null,
        t.total_ms != null ? `รวม ${t.total_ms} ms` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return [
      t.slot_llm_ms != null ? `slots ${t.slot_llm_ms} ms${slotSource ? ` (${slotSource})` : ""}` : null,
      t.sql_ms != null ? `SQL ${t.sql_ms} ms` : null,
      t.format_ms != null ? `format ${t.format_ms} ms` : null,
      t.total_ms != null ? `รวม ${t.total_ms} ms` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function send(message) {
    if (busy) return;
    setBusy(true, "starting");
    addMessage("user", message);
    const assistantEl = addMessage("assistant", "");
    const bubble = assistantEl.querySelector(".bubble");
    const meta = assistantEl.querySelector(".meta-row");
    bubble.innerHTML = `<div class="inline-loading"><span class="spinner"></span><span>กำลังส่ง…</span></div>`;

    try {
      const startRes = await fetch("/api/chat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message, mode }),
      });
      const startBody = await startRes.json().catch(() => ({}));
      if (!startRes.ok) throw new Error(startBody.error || `HTTP ${startRes.status}`);
      chatId = startBody.chatId || chatId;
      const jobId = startBody.jobId;
      const deadline = Date.now() + 180000;

      while (Date.now() < deadline) {
        await sleep(mode === "ask" ? 1500 : 400);
        const poll = await fetch(`/api/chat/job/${encodeURIComponent(jobId)}`);
        const data = await poll.json().catch(() => ({}));
        if (!poll.ok) throw new Error(data.error || `poll ${poll.status}`);
        setBusy(true, data.phase || "starting");
        const label = PHASE_TH[data.phase] || data.phase || "กำลังทำงาน…";
        const elapsed = data.elapsed_ms ? ` (${Math.round(data.elapsed_ms / 1000)} วินาที)` : "";
        bubble.innerHTML = `<div class="inline-loading"><span class="spinner"></span><span>${escapeHtml(label)}${escapeHtml(elapsed)}</span></div>`;

        if (data.status === "done") {
          const text = data.result || "(ว่าง)";
          bubble.innerHTML = renderMarkdown(text);
          if (!bubble.textContent.trim()) bubble.textContent = text;
          meta.textContent = formatTiming(data.timing, mode, data.slot_source);
          if (mode === "ask") askWarm = true;
          break;
        }
        if (data.status === "error") throw new Error(data.error || "งานล้มเหลว");
      }
      if (bubble.querySelector(".inline-loading")) throw new Error("หมดเวลารอคำตอบ");
    } catch (err) {
      bubble.innerHTML = `<p class="error">${escapeHtml(String(err.message || err))}</p>`;
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) return;
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    send(message);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  newChatBtn.addEventListener("click", async () => {
    if (busy) return;
    chatId = uuid();
    if (mode === "ask") {
      await fetch("/api/ask/reset", { method: "POST" });
      askWarm = false;
      applyModeChrome();
      await warmupAsk();
    } else {
      showEmpty();
    }
  });
})();
