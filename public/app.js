import { renderSearchResults } from "./search-render.mjs";

(() => {
  const thread = document.getElementById("thread");
  const form = document.getElementById("form");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const newChatBtn = document.getElementById("newChat");
  const statusPill = document.getElementById("statusPill");
  const overlay = document.getElementById("loadingOverlay");
  const loadingText = document.getElementById("loadingText");
  const hint = document.getElementById("hint");

  const prefersCards = () => window.matchMedia("(max-width: 768px)").matches;

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

  const PHASE_TH = {
    starting: "กำลังเริ่มต้น…",
    slots: "กำลังแยก intent…",
    sql: "กำลังค้น SQL…",
    "sql:hq": "กำลังค้น HQ…",
    "sql:syp": "กำลังค้น SYP…",
    score: "กำลังจัดอันดับ…",
    embed: "กำลังจัดอันดับ semantic…",
    images: "กำลังโหลดรูปสินค้า…",
    format: "กำลังจัดตาราง…",
    done: "เสร็จแล้ว",
    error: "เกิดข้อผิดพลาด",
    timeout: "หมดเวลา",
  };

  function showEmpty() {
    thread.innerHTML = `
      <div class="empty">
        <strong>ค้นหาสินค้า</strong><br />
        พิมพ์ชื่อ ขนาด ยี่ห้อ หรือรหัสสินค้า
        <div class="empty-chips" aria-hidden="true">
          <span>ซีล 31×46×7</span>
          <span>ลูกปืน 6207</span>
          <span>pcode:90915-YZZD1</span>
        </div>
      </div>`;
  }

  showEmpty();

  function setBusy(v, phase) {
    busy = v;
    sendBtn.disabled = v;
    statusPill.innerHTML = v
      ? `<span class="spinner spinner-sm" aria-hidden="true"></span> ${PHASE_TH[phase] || "กำลังทำงาน…"}`
      : "ค้นหาสินค้า";
    statusPill.classList.toggle("busy", v);
    document.body.classList.toggle("is-busy", v);
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

  function renderAssistantContent(data) {
    if (data.search_results) {
      const payload = data.search_results;
      return `<div class="search-results${prefersCards() ? " mobile-cards" : ""}">${renderSearchResults({
        ...payload,
        scores: data.meta?.scores,
      })}</div>`;
    }
    return `<p>${escapeHtml(data.result || "(ว่าง)")}</p>`;
  }

  function addMessage(role, text) {
    if (thread.querySelector(".empty")) thread.innerHTML = "";
    const el = document.createElement("article");
    el.className = `msg ${role}`;
    el.innerHTML = `
      <div class="role">${role === "user" ? "คุณ" : "KCW Search"}</div>
      <div class="bubble"></div>
      <div class="meta-row"></div>
    `;
    const bubble = el.querySelector(".bubble");
    bubble.textContent = role === "user" ? text : "";
    thread.appendChild(el);
    thread.scrollTop = thread.scrollHeight;
    return el;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function formatTiming(t, slotSource, meta) {
    if (!t) return "";
    const parts = [
      t.rules_ms != null ? `rules ${t.rules_ms} ms` : null,
      t.slot_llm_ms != null && t.slot_llm_ms > 0 ? `slots ${t.slot_llm_ms} ms (${slotSource})` : slotSource || null,
      t.sql_ms != null ? `SQL ${t.sql_ms} ms` : null,
      t.score_ms != null ? `score ${t.score_ms} ms` : null,
      t.embed_ms != null && t.embed_ms > 0 ? `embed ${t.embed_ms} ms` : null,
      t.total_ms != null ? `รวม ${t.total_ms} ms` : null,
    ].filter(Boolean);
    if (meta?.recall_count != null) {
      parts.push(`${meta.recall_count}→${meta.row_count ?? "?"}`);
    }
    return parts.join(" · ");
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
        body: JSON.stringify({ chatId, message }),
      });
      const startBody = await startRes.json().catch(() => ({}));
      if (!startRes.ok) throw new Error(startBody.error || `HTTP ${startRes.status}`);
      chatId = startBody.chatId || chatId;
      const jobId = startBody.jobId;
      const deadline = Date.now() + 180000;

      while (Date.now() < deadline) {
        await sleep(400);
        const poll = await fetch(`/api/chat/job/${encodeURIComponent(jobId)}`);
        const data = await poll.json().catch(() => ({}));
        if (!poll.ok) throw new Error(data.error || `poll ${poll.status}`);
        setBusy(true, data.phase || "starting");
        const label = PHASE_TH[data.phase] || data.phase || "กำลังทำงาน…";
        const elapsed = data.elapsed_ms ? ` (${Math.round(data.elapsed_ms / 1000)} วินาที)` : "";
        bubble.innerHTML = `<div class="inline-loading"><span class="spinner"></span><span>${escapeHtml(label)}${escapeHtml(elapsed)}</span></div>`;

        if (data.status === "done") {
          bubble.innerHTML = renderAssistantContent(data);
          meta.textContent = formatTiming(data.timing, data.slot_source, data.meta);
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

  thread.addEventListener("click", (e) => {
    const chip = e.target.closest(".empty-chips span");
    if (!chip || busy) return;
    input.value = chip.textContent.trim();
    input.focus();
  });

  newChatBtn.addEventListener("click", () => {
    if (busy) return;
    chatId = uuid();
    showEmpty();
  });
})();
