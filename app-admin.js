import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { supabaseConfig } from "./supabase-config.js";

const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);

// ============================================================
// STATE
// ============================================================
let pendingMedia = { photos: [], videos: [] };
let editingContentId = null;
let categoriesCache = [];

// ============================================================
// TOAST
// ============================================================
function showToast(msg) {
  const host = document.getElementById("toastHost");
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ============================================================
// AUTH
// ============================================================
document.getElementById("loginBtn").onclick = async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");
  errorEl.textContent = "";

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { errorEl.textContent = error.message; return; }
  await enterAdmin();
};

document.getElementById("logoutBtn").onclick = async () => {
  await supabase.auth.signOut();
  document.getElementById("adminShell").style.display = "none";
  document.getElementById("loginWrap").style.display = "flex";
};

async function enterAdmin() {
  document.getElementById("loginWrap").style.display = "none";
  document.getElementById("adminShell").style.display = "flex";
  await Promise.all([loadContent(), loadCategories(), loadSiteSettings(), loadWithdrawals(), loadNotifications(), loadNetworks(), loadPlacements(), loadPages(), loadMessages(), loadUsers(), loadActivity()]);
}

// Auto-login if session already exists (so refresh doesn't log you out)
supabase.auth.getSession().then(({ data }) => {
  if (data.session) enterAdmin();
});

// ============================================================
// SIDEBAR NAVIGATION
// ============================================================
document.querySelectorAll(".side-link[data-panel]").forEach(link => {
  link.onclick = () => {
    document.querySelectorAll(".side-link").forEach(l => l.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    link.classList.add("active");
    document.getElementById(link.dataset.panel).classList.add("active");
    if (link.dataset.panel === "panelAdd" && !editingContentId) resetForm();
  };
});

// ============================================================
// THEME TOGGLE (sun/moon)
// ============================================================
const themeToggle = document.getElementById("themeToggle");
function applyTheme(isLight) {
  document.body.classList.toggle("light-theme", isLight);
  themeToggle.innerHTML = isLight
    ? `<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/></svg>`   // moon (tap to go dark)
    : `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`; // sun (tap to go light)
}
const savedTheme = localStorage.getItem("famb_theme") || "dark";
applyTheme(savedTheme === "light");
themeToggle.onclick = () => {
  const isLight = !document.body.classList.contains("light-theme");
  applyTheme(isLight);
  localStorage.setItem("famb_theme", isLight ? "light" : "dark");
};

// ============================================================
// MEDIA UPLOAD (Add Content form)
// ============================================================
document.getElementById("mediaUpload").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const ext = file.name.split(".").pop();
    const path = `content/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("famb-media").upload(path, file);
    if (error) { showToast("Upload failed: " + error.message); continue; }
    const { data: pub } = supabase.storage.from("famb-media").getPublicUrl(path);
    const isVideo = file.type.startsWith("video");
    (isVideo ? pendingMedia.videos : pendingMedia.photos).push({ url: pub.publicUrl, isVideo });
  }
  renderMediaPreview();
  e.target.value = "";
});

document.getElementById("addMediaLink").onclick = () => {
  const input = document.getElementById("mediaLinkInput");
  const url = input.value.trim();
  if (!url) return;
  const isVideo = /\.(mp4|webm|mov)$/i.test(url) || url.includes("youtube") || url.includes("youtu.be");
  (isVideo ? pendingMedia.videos : pendingMedia.photos).push({ url, isVideo });
  input.value = "";
  renderMediaPreview();
};

function renderMediaPreview() {
  const wrap = document.getElementById("mediaPreview");
  wrap.innerHTML = "";
  const all = [
    ...pendingMedia.photos.map((m, i) => ({ ...m, kind: "photos", idx: i })),
    ...pendingMedia.videos.map((m, i) => ({ ...m, kind: "videos", idx: i }))
  ];
  all.forEach(item => {
    const box = document.createElement("div");
    box.className = "media-item-wrap";
    box.innerHTML = `
      ${item.isVideo
        ? `<video src="${item.url}" class="thumb"></video>`
        : `<img src="${item.url}" class="thumb">`}
      <button class="media-remove" type="button">×</button>`;
    box.querySelector(".media-remove").onclick = () => {
      pendingMedia[item.kind].splice(item.idx, 1);
      renderMediaPreview();
    };
    wrap.appendChild(box);
  });
}

// ============================================================
// CATEGORIES
// ============================================================
async function loadCategories() {
  const { data, error } = await supabase.from("categories").select("*").order("name");
  if (error) return;
  categoriesCache = data || [];
  const datalist = document.getElementById("categoryOptions");
  datalist.innerHTML = categoriesCache.map(c => `<option value="${escapeHtml(c.name)}">`).join("");
  const chips = document.getElementById("categoryChips");
  chips.innerHTML = categoriesCache.map(c =>
    `<span class="chip" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>`
  ).join("");
  chips.querySelectorAll(".chip").forEach(chip => {
    chip.onclick = () => { document.getElementById("contentCategory").value = chip.dataset.name; };
  });
}

async function ensureCategory(name) {
  if (!name) return;
  const exists = categoriesCache.some(c => c.name.toLowerCase() === name.toLowerCase());
  if (exists) return;
  const { error } = await supabase.from("categories").insert({ name });
  if (!error) loadCategories();
}

// ============================================================
// ADD / EDIT CONTENT
// ============================================================
document.getElementById("publishBtn").onclick = async () => {
  const title = document.getElementById("contentTitle").value.trim();
  const content_type = document.getElementById("contentType").value;
  const category = document.getElementById("contentCategory").value.trim();
  const description = document.getElementById("contentDescription").value.trim();
  const action_link = document.getElementById("contentActionLink").value.trim();
  const action_label = document.getElementById("contentActionLabel").value.trim();

  if (!title) { showToast("Please enter a title"); return; }
  if (!pendingMedia.photos.length && !pendingMedia.videos.length && content_type !== "article") {
    showToast("Please add at least one photo or video"); return;
  }

  const payload = {
    title, category, content_type, description,
    action_link: action_link || null,
    action_label: action_label || "Visit Link",
    media: {
      photos: pendingMedia.photos.map(m => m.url),
      videos: pendingMedia.videos.map(m => m.url)
    },
    updated_at: new Date().toISOString()
  };

  let error;
  if (editingContentId) {
    ({ error } = await supabase.from("content").update(payload).eq("id", editingContentId));
  } else {
    ({ error } = await supabase.from("content").insert(payload));
  }

  if (error) { showToast("Could not save: " + error.message); return; }

  if (category) await ensureCategory(category);
  showToast(editingContentId ? "Content updated!" : "Published!");
  resetForm();
  loadContent();
  document.querySelector('.side-link[data-panel="panelContent"]').click();
};

function resetForm() {
  editingContentId = null;
  document.getElementById("formHeading").textContent = "Add Content";
  document.getElementById("editingIdNote").style.display = "none";
  document.getElementById("contentTitle").value = "";
  document.getElementById("contentType").value = "article";
  document.getElementById("contentCategory").value = "";
  document.getElementById("contentDescription").value = "";
  document.getElementById("contentActionLink").value = "";
  document.getElementById("contentActionLabel").value = "";
  pendingMedia = { photos: [], videos: [] };
  renderMediaPreview();
}

// ============================================================
// CONTENT LIST
// ============================================================
async function loadContent() {
  const { data, error } = await supabase.from("content").select("*").order("created_at", { ascending: false });
  const list = document.getElementById("contentList");
  if (error) { list.innerHTML = `<p class="helper">Could not load content.</p>`; return; }
  if (!data || !data.length) { list.innerHTML = `<p class="helper">No content yet — add your first article/video from "Add Content".</p>`; return; }

  list.innerHTML = data.map(c => `
    <div class="content-card">
      <div class="content-card-info">
        <div class="content-card-title">${escapeHtml(c.title)}</div>
        <div class="content-card-meta">${escapeHtml(c.content_type)} ${c.category ? "· " + escapeHtml(c.category) : ""}</div>
      </div>
      <div class="content-card-actions">
        <button class="btn" data-edit="${c.id}">Edit</button>
        <button class="btn danger" data-delete="${c.id}">Delete</button>
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-edit]").forEach(btn => btn.onclick = () => editContent(btn.dataset.edit, data));
  list.querySelectorAll("[data-delete]").forEach(btn => btn.onclick = () => deleteContent(btn.dataset.delete));
}

function editContent(id, data) {
  const c = data.find(x => x.id === id);
  if (!c) return;
  editingContentId = id;
  document.getElementById("formHeading").textContent = "Edit Content";
  document.getElementById("editingIdNote").style.display = "inline";
  document.getElementById("editingIdNote").textContent = "Editing: " + c.title;
  document.getElementById("contentTitle").value = c.title || "";
  document.getElementById("contentType").value = c.content_type || "article";
  document.getElementById("contentCategory").value = c.category || "";
  document.getElementById("contentDescription").value = c.description || "";
  document.getElementById("contentActionLink").value = c.action_link || "";
  document.getElementById("contentActionLabel").value = c.action_label || "";
  pendingMedia = {
    photos: (c.media?.photos || []).map(url => ({ url, isVideo: false })),
    videos: (c.media?.videos || []).map(url => ({ url, isVideo: true }))
  };
  renderMediaPreview();
  document.querySelectorAll(".side-link").forEach(l => l.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector('.side-link[data-panel="panelAdd"]').classList.add("active");
  document.getElementById("panelAdd").classList.add("active");
}

async function deleteContent(id) {
  if (!confirm("Delete this content? This cannot be undone.")) return;
  const { error } = await supabase.from("content").delete().eq("id", id);
  if (error) { showToast("Could not delete: " + error.message); return; }
  showToast("Deleted");
  loadContent();
}

// ============================================================
// WITHDRAWALS
// ============================================================
async function loadWithdrawals() {
  const { data, error } = await supabase.from("withdrawals").select("*").order("created_at", { ascending: false });
  const list = document.getElementById("withdrawalsList");
  if (error) { list.innerHTML = `<p class="helper">Could not load withdrawals.</p>`; return; }
  if (!data || !data.length) { list.innerHTML = `<p class="helper">No withdrawal requests yet.</p>`; return; }

  const pendingCount = data.filter(w => w.status === "pending").length;
  document.getElementById("withdrawDot").style.display = pendingCount ? "inline-block" : "none";

  list.innerHTML = data.map(w => `
    <div class="content-card">
      <div class="content-card-info">
        <div class="content-card-title">Rs. ${Number(w.amount).toLocaleString()} <span class="status-badge status-${w.status}">${w.status}</span></div>
        <div class="content-card-meta">
          ${escapeHtml(w.method || "")}${w.crypto_network ? " (" + escapeHtml(w.crypto_network.toUpperCase()) + ")" : ""} · Holder: ${escapeHtml(w.holder_name || "—")}<br>
          Account/Address: ${escapeHtml(w.account_details || "—")}<br>
          Contact (WhatsApp/Telegram): ${escapeHtml(w.contact_info || "—")}
        </div>
      </div>
      <div class="content-card-actions">
        ${w.status === "pending" ? `
          <button class="btn primary" data-approve="${w.id}">Approve</button>
          <button class="btn danger" data-reject="${w.id}">Reject</button>` : ""}
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-approve]").forEach(btn => btn.onclick = () => updateWithdrawal(btn.dataset.approve, "paid"));
  list.querySelectorAll("[data-reject]").forEach(btn => btn.onclick = () => updateWithdrawal(btn.dataset.reject, "rejected"));
}

async function updateWithdrawal(id, status) {
  const { error } = await supabase.from("withdrawals")
    .update({ status, processed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) { showToast("Could not update: " + error.message); return; }
  showToast("Withdrawal " + status);
  loadWithdrawals();
}

// ============================================================
// NOTIFICATIONS
// ============================================================
async function loadNotifications() {
  const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);
  const list = document.getElementById("notifList");
  if (error) { list.innerHTML = `<p class="helper">Could not load notifications.</p>`; return; }
  if (!data || !data.length) { list.innerHTML = `<p class="helper">No notifications yet.</p>`; return; }

  const unread = data.filter(n => !n.read).length;
  document.getElementById("notifDot").style.display = unread ? "inline-block" : "none";

  list.innerHTML = data.map(n => `
    <div class="notif-item ${n.read ? "" : "unread"}">${escapeHtml(n.message || "")}</div>
  `).join("");

  // mark all as read once viewed
  const unreadIds = data.filter(n => !n.read).map(n => n.id);
  if (unreadIds.length) {
    await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
    document.getElementById("notifDot").style.display = "none";
  }
}

// ============================================================
// APP BRANDING (site_settings)
// ============================================================
async function loadSiteSettings() {
  const { data, error } = await supabase.from("site_settings").select("*").eq("id", "main").maybeSingle();
  if (error || !data) return;

  document.getElementById("siteNameInput").value = data.app_name || "";
  document.getElementById("bannerTitleInput").value = data.banner_title || "";
  document.getElementById("bannerSubtitleInput").value = data.banner_subtitle || "";
  document.getElementById("referralBonusInput").value = data.referral_bonus ?? "";
  document.getElementById("minWithdrawInput").value = data.min_withdrawal ?? "";
  document.getElementById("userShareInput").value = data.user_share_percent ?? "";
  document.getElementById("defaultCurrencyInput").value = data.default_currency || "PKR";

  if (data.logo_url) {
    document.getElementById("logoPreviewImg").src = data.logo_url;
    document.getElementById("logoPreviewImg").style.display = "block";
  }

  const socials = data.social_links || {};
  const fillSocial = (key, inputId, checkboxId) => {
    const entry = socials[key];
    const url = typeof entry === "object" && entry !== null ? entry.url : entry;
    const show = typeof entry === "object" && entry !== null ? entry.show !== false : true;
    document.getElementById(inputId).value = url || "";
    document.getElementById(checkboxId).checked = show;
  };
  fillSocial("facebook", "facebookInput", "facebookShow");
  fillSocial("instagram", "instagramInput", "instagramShow");
  fillSocial("tiktok", "tiktokInput", "tiktokShow");
  fillSocial("whatsapp", "whatsappInput", "whatsappShow");
}

document.getElementById("siteLogoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const path = `branding/logo_${Date.now()}.${file.name.split(".").pop()}`;
  const { error } = await supabase.storage.from("famb-media").upload(path, file, { upsert: true });
  if (error) { showToast("Logo upload failed: " + error.message); return; }
  const { data: pub } = supabase.storage.from("famb-media").getPublicUrl(path);
  document.getElementById("logoPreviewImg").src = pub.publicUrl;
  document.getElementById("logoPreviewImg").style.display = "block";
  document.getElementById("logoPreviewImg").dataset.pendingUrl = pub.publicUrl;
});

document.getElementById("saveSiteBtn").onclick = async () => {
  const logoImg = document.getElementById("logoPreviewImg");
  const payload = {
    id: "main",
    app_name: document.getElementById("siteNameInput").value.trim(),
    banner_title: document.getElementById("bannerTitleInput").value.trim(),
    banner_subtitle: document.getElementById("bannerSubtitleInput").value.trim(),
    logo_url: logoImg.dataset.pendingUrl || logoImg.src || null,
    social_links: {
      facebook: { url: document.getElementById("facebookInput").value.trim(), show: document.getElementById("facebookShow").checked },
      instagram: { url: document.getElementById("instagramInput").value.trim(), show: document.getElementById("instagramShow").checked },
      tiktok: { url: document.getElementById("tiktokInput").value.trim(), show: document.getElementById("tiktokShow").checked },
      whatsapp: { url: document.getElementById("whatsappInput").value.trim(), show: document.getElementById("whatsappShow").checked }
    }
  };
  const { error } = await supabase.from("site_settings").upsert(payload);
  if (error) { showToast("Could not save: " + error.message); return; }
  showToast("Branding saved!");
};

// ============================================================
// ADS — NETWORKS
// ============================================================
let networksCache = [];

document.getElementById("networkType").addEventListener("change", (e) => {
  const isCode = e.target.value === "code_snippet";
  document.getElementById("adUnitWrap").style.display = isCode ? "none" : "block";
  document.getElementById("htmlCodeWrap").style.display = isCode ? "block" : "none";
});

async function loadNetworks() {
  const { data, error } = await supabase.from("ad_networks").select("*").order("created_at", { ascending: false });
  networksCache = data || [];
  const list = document.getElementById("networksList");
  if (error) { list.innerHTML = `<p class="helper">Could not load networks.</p>`; return; }
  if (!data || !data.length) { list.innerHTML = `<p class="helper">No ad networks yet — add one above.</p>`; }
  else {
    list.innerHTML = data.map(n => `
      <div class="content-card">
        <div class="content-card-info">
          <div class="content-card-title">${escapeHtml(n.name)} ${n.active ? "" : "<span class=\"status-badge status-rejected\">inactive</span>"}</div>
          <div class="content-card-meta">${formatLabel(n.ad_format)} · ${n.network_type === "sdk" ? "SDK" : "Code snippet"} · ${n.currency} ${n.estimated_cpm} / 1000 views</div>
        </div>
        <div class="content-card-actions">
          <button class="btn" data-toggle-network="${n.id}" data-active="${n.active}">${n.active ? "Deactivate" : "Activate"}</button>
          <button class="btn danger" data-delete-network="${n.id}">Delete</button>
        </div>
      </div>`).join("");
    list.querySelectorAll("[data-toggle-network]").forEach(btn => btn.onclick = () => toggleNetwork(btn.dataset.toggleNetwork, btn.dataset.active === "true"));
    list.querySelectorAll("[data-delete-network]").forEach(btn => btn.onclick = () => deleteNetwork(btn.dataset.deleteNetwork));
  }

  // refresh the network dropdown used by the placement form
  const select = document.getElementById("placementNetwork");
  select.innerHTML = (data || []).map(n => `<option value="${n.id}">${escapeHtml(n.name)}</option>`).join("");
}

document.getElementById("addNetworkBtn").onclick = async () => {
  const name = document.getElementById("networkName").value.trim();
  const network_type = document.getElementById("networkType").value;
  const ad_format = document.getElementById("networkAdFormat").value;
  const ad_unit_id = document.getElementById("networkAdUnitId").value.trim();
  const html_code = document.getElementById("networkHtmlCode").value.trim();
  const estimated_cpm = Number(document.getElementById("networkCpm").value) || 1;
  const currency = document.getElementById("networkCurrency").value;

  if (!name) { showToast("Please enter a network name"); return; }

  const { error } = await supabase.from("ad_networks").insert({
    name, network_type, ad_format, ad_unit_id: ad_unit_id || null, html_code: html_code || null,
    estimated_cpm, currency
  });
  if (error) { showToast("Could not add network: " + error.message); return; }

  showToast("Ad network added!");
  document.getElementById("networkName").value = "";
  document.getElementById("networkAdUnitId").value = "";
  document.getElementById("networkHtmlCode").value = "";
  document.getElementById("networkCpm").value = "";
  loadNetworks();
};

async function toggleNetwork(id, currentlyActive) {
  const { error } = await supabase.from("ad_networks").update({ active: !currentlyActive }).eq("id", id);
  if (error) { showToast("Could not update: " + error.message); return; }
  loadNetworks();
}

async function deleteNetwork(id) {
  if (!confirm("Delete this ad network? Any placements using it will also stop working.")) return;
  const { error } = await supabase.from("ad_networks").delete().eq("id", id);
  if (error) { showToast("Could not delete: " + error.message); return; }
  showToast("Deleted");
  loadNetworks();
}

// ============================================================
// ADS — PLACEMENTS
// ============================================================
async function loadPlacements() {
  const { data, error } = await supabase.from("ad_placements").select("*, ad_networks(name)").order("created_at", { ascending: false });
  const list = document.getElementById("placementsList");
  if (error) { list.innerHTML = `<p class="helper">Could not load placements.</p>`; return; }
  if (!data || !data.length) { list.innerHTML = `<p class="helper">No placements yet — add one above once you have a network.</p>`; return; }

  list.innerHTML = data.map(p => `
    <div class="content-card">
      <div class="content-card-info">
        <div class="content-card-title">${escapeHtml(p.name || p.location)} ${p.active ? "" : "<span class=\"status-badge status-rejected\">inactive</span>"}</div>
        <div class="content-card-meta">${escapeHtml(p.location)} · network: ${escapeHtml(p.ad_networks?.name || "—")} ${p.cooldown_minutes ? "· cooldown " + p.cooldown_minutes + "m" : ""}</div>
      </div>
      <div class="content-card-actions">
        <button class="btn" data-toggle-placement="${p.id}" data-active="${p.active}">${p.active ? "Deactivate" : "Activate"}</button>
        <button class="btn danger" data-delete-placement="${p.id}">Delete</button>
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-toggle-placement]").forEach(btn => btn.onclick = () => togglePlacement(btn.dataset.togglePlacement, btn.dataset.active === "true"));
  list.querySelectorAll("[data-delete-placement]").forEach(btn => btn.onclick = () => deletePlacement(btn.dataset.deletePlacement));
}

document.getElementById("addPlacementBtn").onclick = async () => {
  const network_id = document.getElementById("placementNetwork").value;
  const name = document.getElementById("placementName").value.trim();
  const location = document.getElementById("placementLocation").value;
  const cta_text = document.getElementById("placementCta").value.trim();
  const show_every_n_items = document.getElementById("placementEveryN").value ? Number(document.getElementById("placementEveryN").value) : null;
  const show_after_seconds = document.getElementById("placementAfterSec").value ? Number(document.getElementById("placementAfterSec").value) : null;
  const cooldown_minutes = Number(document.getElementById("placementCooldown").value) || 0;

  if (!network_id) { showToast("Please add a network first"); return; }

  const { error } = await supabase.from("ad_placements").insert({
    network_id, name, location, cta_text: cta_text || null,
    show_every_n_items, show_after_seconds, cooldown_minutes
  });
  if (error) { showToast("Could not add placement: " + error.message); return; }

  showToast("Placement added!");
  document.getElementById("placementName").value = "";
  document.getElementById("placementCta").value = "";
  document.getElementById("placementEveryN").value = "";
  document.getElementById("placementAfterSec").value = "";
  document.getElementById("placementCooldown").value = "";
  loadPlacements();
};

async function togglePlacement(id, currentlyActive) {
  const { error } = await supabase.from("ad_placements").update({ active: !currentlyActive }).eq("id", id);
  if (error) { showToast("Could not update: " + error.message); return; }
  loadPlacements();
}

async function deletePlacement(id) {
  if (!confirm("Delete this placement?")) return;
  const { error } = await supabase.from("ad_placements").delete().eq("id", id);
  if (error) { showToast("Could not delete: " + error.message); return; }
  showToast("Deleted");
  loadPlacements();
}

// ============================================================
// EARNING RULES
// ============================================================
document.getElementById("saveRulesBtn").onclick = async () => {
  const payload = {
    id: "main",
    referral_bonus: Number(document.getElementById("referralBonusInput").value) || 0,
    min_withdrawal: Number(document.getElementById("minWithdrawInput").value) || 0,
    user_share_percent: Number(document.getElementById("userShareInput").value) || 45,
    default_currency: document.getElementById("defaultCurrencyInput").value
  };
  const { error } = await supabase.from("site_settings").upsert(payload);
  if (error) { showToast("Could not save: " + error.message); return; }
  showToast("Rules saved!");
};

// ============================================================
// UTIL
// ============================================================
function formatLabel(format) {
  if (format === "banner") return "Banner";
  if (format === "interstitial") return "Interstitial";
  return "Rewarded Video";
}

// ============================================================
// PAGES (About Us, Disclaimer, Privacy Policy, Earning Guide)
// ============================================================
async function loadPages() {
  const { data, error } = await supabase.from("static_pages").select("*").order("slug");
  const wrap = document.getElementById("pagesEditorWrap");
  if (!wrap) return;
  if (error) { wrap.innerHTML = `<p class="helper">Could not load pages.</p>`; return; }

  wrap.innerHTML = (data || []).map(p => `
    <div class="form-card" style="margin-bottom:20px;">
      <h3 style="margin-top:0;font-size:16px;">${escapeHtml(p.title)}</h3>
      <div class="form-group">
        <label>Title</label>
        <input type="text" data-page-title="${p.slug}" value="${escapeHtml(p.title)}">
      </div>
      <div class="form-group">
        <label>Content</label>
        <textarea rows="8" data-page-content="${p.slug}">${escapeHtml(p.content)}</textarea>
      </div>
      <button class="btn primary" data-save-page="${p.slug}">Save "${escapeHtml(p.title)}"</button>
    </div>`).join("");

  wrap.querySelectorAll("[data-save-page]").forEach(btn => {
    btn.onclick = async () => {
      const slug = btn.dataset.savePage;
      const title = wrap.querySelector(`[data-page-title="${slug}"]`).value.trim();
      const content = wrap.querySelector(`[data-page-content="${slug}"]`).value.trim();
      const { error } = await supabase.from("static_pages")
        .update({ title, content, updated_at: new Date().toISOString() })
        .eq("slug", slug);
      if (error) { showToast("Could not save: " + error.message); return; }
      showToast(`"${title}" saved!`);
    };
  });
}

// ============================================================
// MESSAGES (Contact Us submissions)
// ============================================================
async function loadMessages() {
  const { data, error } = await supabase.from("contact_messages").select("*").order("created_at", { ascending: false });
  const list = document.getElementById("messagesList");
  if (!list) return;
  if (error) { list.innerHTML = `<p class="helper">Could not load messages.</p>`; return; }
  if (!data || !data.length) { list.innerHTML = `<p class="helper">No messages yet.</p>`; return; }

  const unread = data.filter(m => !m.read).length;
  const dot = document.getElementById("messagesDot");
  if (dot) dot.style.display = unread ? "inline-block" : "none";

  list.innerHTML = data.map(m => `
    <div class="notif-item ${m.read ? "" : "unread"}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
      <div>
        <strong>${escapeHtml(m.name || "Anonymous")}</strong> ${m.email ? "(" + escapeHtml(m.email) + ")" : ""}<br>
        ${escapeHtml(m.message)}
      </div>
      <button class="btn danger" style="flex-shrink:0;padding:4px 10px;" data-delete-message="${m.id}" title="Delete">✕</button>
    </div>
  `).join("");

  list.querySelectorAll("[data-delete-message]").forEach(btn => {
    btn.onclick = async () => {
      const { error } = await supabase.from("contact_messages").delete().eq("id", btn.dataset.deleteMessage);
      if (error) { showToast("Could not delete: " + error.message); return; }
      loadMessages();
    };
  });

  const unreadIds = data.filter(m => !m.read).map(m => m.id);
  if (unreadIds.length) {
    await supabase.from("contact_messages").update({ read: true }).in("id", unreadIds);
    if (dot) dot.style.display = "none";
  }
}

// ============================================================
// USERS (with country flag) + LIVE ACTIVITY FEED
// ============================================================
function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  const codePoints = [...countryCode.toUpperCase()].map(c => 0x1F1E6 + (c.charCodeAt(0) - 65));
  return String.fromCodePoint(...codePoints);
}

async function loadUsers() {
  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
  const list = document.getElementById("usersList");
  if (!list) return;
  if (error) { list.innerHTML = `<p class="helper">Could not load users.</p>`; return; }
  if (!data || !data.length) { list.innerHTML = `<p class="helper">No users yet.</p>`; return; }

  list.innerHTML = data.map(u => `
    <div class="content-card">
      <div class="content-card-info">
        <div class="content-card-title">${flagEmoji(u.country_code)} ${escapeHtml(u.full_name || "Unnamed user")}</div>
        <div class="content-card-meta">${escapeHtml(u.email || "")} · ${escapeHtml(u.country_name || "Unknown country")} · Balance: ${Number(u.wallet_balance || 0).toFixed(2)}</div>
      </div>
    </div>`).join("");
}

async function loadActivity() {
  const { data, error } = await supabase
    .from("ad_events")
    .select("*, profiles(full_name, country_code, country_name)")
    .order("created_at", { ascending: false })
    .limit(30);
  const list = document.getElementById("activityList");
  if (!list) return;
  if (error) { list.innerHTML = `<p class="helper">Could not load activity.</p>`; return; }
  if (!data || !data.length) { list.innerHTML = `<p class="helper">No ad activity yet.</p>`; return; }

  list.innerHTML = data.map(e => {
    const user = e.profiles || {};
    const time = new Date(e.created_at).toLocaleTimeString();
    return `<div class="notif-item">
      ${flagEmoji(user.country_code)} <strong>${escapeHtml(user.full_name || "Unknown user")}</strong>
      — ${escapeHtml(e.event_type)} ${e.earned_amount > 0 ? "(+" + Number(e.earned_amount).toFixed(4) + ")" : ""}
      <span style="color:#97A2BE;font-size:12px;"> · ${escapeHtml(user.country_name || "")} · ${time}</span>
    </div>`;
  }).join("");
}

// Live updates: whenever a new ad_event comes in, refresh the feed
// automatically — this is what makes "Recent Activity" feel live
// instead of needing a manual page refresh.
supabase
  .channel("admin-activity-feed")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "ad_events" }, () => {
    loadActivity();
  })
  .subscribe();

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

